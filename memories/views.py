from __future__ import annotations

import base64
import mimetypes
from datetime import timedelta
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.core.files.base import File
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404, HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_http_methods, require_POST

from .forms import MemoirForm, RegisterForm
from .models import Memoir, MemoirMedia, MobileUploadItem, MobileUploadSession


try:
    import qrcode
except ImportError:  # pragma: no cover - dependency is declared, this keeps local checks usable before install.
    qrcode = None


IMAGE_EXTENSIONS = {".apng", ".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".m4v", ".mov", ".mp4", ".mpeg", ".webm"}


def register(request: HttpRequest) -> HttpResponse:
    if not settings.ALLOW_PUBLIC_REGISTRATION:
        raise Http404

    if request.user.is_authenticated:
        return redirect("memoir_list")

    if request.method == "POST":
        form = RegisterForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, "注册成功，欢迎来到你的回忆库。")
            return redirect("memoir_list")
    else:
        form = RegisterForm()

    return render(request, "registration/register.html", {"form": form})


def classify_upload(upload) -> tuple[str, str] | None:
    mime_type = upload.content_type or mimetypes.guess_type(upload.name)[0] or ""
    suffix = Path(upload.name).suffix.lower()
    if mime_type.startswith("image/") or suffix in IMAGE_EXTENSIONS:
        return MemoirMedia.MediaType.IMAGE, mime_type
    if mime_type.startswith("video/") or suffix in VIDEO_EXTENSIONS:
        return MemoirMedia.MediaType.VIDEO, mime_type
    return None


def mobile_upload_expires_at():
    ttl = max(settings.MOBILE_UPLOAD_SESSION_TTL_MINUTES, 1)
    return timezone.now() + timedelta(minutes=ttl)


def create_mobile_upload_session(
    request: HttpRequest,
    mode: str,
    memoir: Memoir | None = None,
) -> MobileUploadSession:
    return MobileUploadSession.objects.create(
        owner=request.user,
        mode=mode,
        memoir=memoir,
        expires_at=mobile_upload_expires_at(),
    )


def posted_mobile_upload_session(
    request: HttpRequest,
    mode: str,
    memoir: Memoir | None = None,
) -> MobileUploadSession | None:
    token = request.POST.get("mobile_upload_token", "").strip()
    if not token:
        return None

    query = MobileUploadSession.objects.filter(
        token=token,
        owner=request.user,
        mode=mode,
        is_consumed=False,
    )
    if memoir is None:
        query = query.filter(memoir__isnull=True)
    else:
        query = query.filter(memoir=memoir)
    return query.first()


def get_mobile_upload_session(
    request: HttpRequest,
    mode: str,
    memoir: Memoir | None = None,
) -> MobileUploadSession:
    if request.method == "POST":
        session = posted_mobile_upload_session(request, mode, memoir)
        if session:
            return session
    return create_mobile_upload_session(request, mode, memoir)


def mobile_upload_url(request: HttpRequest, session: MobileUploadSession) -> str:
    return request.build_absolute_uri(reverse("mobile_upload", kwargs={"token": session.token}))


def mobile_upload_qr_data_uri(url: str) -> str:
    if qrcode is None:
        return ""
    image = qrcode.make(url)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def mobile_upload_context(request: HttpRequest, session: MobileUploadSession) -> dict[str, object]:
    upload_url = mobile_upload_url(request, session)
    return {
        "mobile_upload_session": session,
        "mobile_upload_url": upload_url,
        "mobile_upload_qr_data_uri": mobile_upload_qr_data_uri(upload_url),
        "mobile_upload_status_url": reverse("mobile_upload_status", kwargs={"token": session.token}),
        "mobile_upload_items": session.items.all(),
    }


def collect_uploads(request: HttpRequest, form: MemoirForm) -> list[tuple[object, tuple[str, str]]]:
    classified_uploads = []
    for upload in request.FILES.getlist("media"):
        classification = classify_upload(upload)
        if classification is None:
            form.add_error(None, f"不支持的文件类型：{upload.name}")
        else:
            classified_uploads.append((upload, classification))
    return classified_uploads


def save_upload(memoir: Memoir, upload, classification: tuple[str, str]) -> MemoirMedia:
    media_type, mime_type = classification
    return MemoirMedia.objects.create(
        memoir=memoir,
        file=upload,
        original_filename=upload.name,
        media_type=media_type,
        mime_type=mime_type,
        size=upload.size,
    )


def save_uploads(memoir: Memoir, classified_uploads: list[tuple[object, tuple[str, str]]]) -> list[MemoirMedia]:
    media_items = []
    for upload, classification in classified_uploads:
        media_items.append(save_upload(memoir, upload, classification))
    return media_items


def promote_mobile_upload_items(memoir: Memoir, session: MobileUploadSession) -> None:
    for item in session.items.filter(media__isnull=True).exclude(file=""):
        if not item.file:
            continue
        item.file.open("rb")
        try:
            uploaded_file = File(item.file, name=item.original_filename or Path(item.file.name).name)
            media = MemoirMedia.objects.create(
                memoir=memoir,
                file=uploaded_file,
                original_filename=item.original_filename,
                media_type=item.media_type,
                mime_type=item.mime_type,
                size=item.size,
            )
        finally:
            item.file.close()
        item.media = media
        item.file.delete(save=False)
        item.file = ""
        item.save(update_fields=["media", "file"])
    session.is_consumed = True
    session.save(update_fields=["is_consumed"])


@login_required
def memoir_list(request: HttpRequest) -> HttpResponse:
    query = request.GET.get("q", "").strip()
    mood = request.GET.get("mood", "").strip()

    memoirs = Memoir.objects.filter(owner=request.user).prefetch_related("media_items")
    if query:
        memoirs = memoirs.filter(
            Q(title__icontains=query)
            | Q(story__icontains=query)
            | Q(location__icontains=query)
            | Q(mood__icontains=query)
        )
    if mood:
        memoirs = memoirs.filter(mood=mood)

    mood_choices = (
        Memoir.objects.filter(owner=request.user)
        .exclude(mood="")
        .order_by("mood")
        .values_list("mood", flat=True)
        .distinct()
    )
    all_memoirs = Memoir.objects.filter(owner=request.user)
    context = {
        "memoirs": memoirs,
        "query": query,
        "active_mood": mood,
        "mood_choices": mood_choices,
        "memoir_count": all_memoirs.count(),
        "media_count": MemoirMedia.objects.filter(memoir__owner=request.user).count(),
    }
    return render(request, "memories/memoir_list.html", context)


@login_required
def memoir_create(request: HttpRequest) -> HttpResponse:
    mobile_session = get_mobile_upload_session(request, MobileUploadSession.Mode.CREATE)
    if request.method == "POST":
        form = MemoirForm(request.POST)
        classified_uploads = collect_uploads(request, form)

        if form.is_valid():
            with transaction.atomic():
                memoir = form.save(commit=False)
                memoir.owner = request.user
                memoir.save()
                save_uploads(memoir, classified_uploads)
                promote_mobile_upload_items(memoir, mobile_session)
            messages.success(request, "已保存这段回忆。")
            return redirect("memoir_list")
    else:
        form = MemoirForm()

    context = {
        "form": form,
        "mode": "create",
        **mobile_upload_context(request, mobile_session),
    }
    return render(request, "memories/memoir_form.html", context)


@login_required
def memoir_update(request: HttpRequest, pk) -> HttpResponse:
    memoir = get_object_or_404(
        Memoir.objects.prefetch_related("media_items"),
        pk=pk,
        owner=request.user,
    )
    mobile_session = get_mobile_upload_session(request, MobileUploadSession.Mode.EDIT, memoir)

    if request.method == "POST":
        form = MemoirForm(request.POST, instance=memoir)
        classified_uploads = collect_uploads(request, form)
        media_to_delete = request.POST.getlist("delete_media")

        if form.is_valid():
            with transaction.atomic():
                memoir = form.save()
                if media_to_delete:
                    MemoirMedia.objects.filter(
                        id__in=media_to_delete,
                        memoir=memoir,
                        memoir__owner=request.user,
                    ).delete()
                save_uploads(memoir, classified_uploads)
                mobile_session.is_consumed = True
                mobile_session.save(update_fields=["is_consumed"])
            messages.success(request, "已更新这段回忆。")
            return redirect("memoir_list")
    else:
        form = MemoirForm(instance=memoir)

    context = {
        "form": form,
        "memoir": memoir,
        "mode": "edit",
        "existing_media": memoir.media_items.all(),
        **mobile_upload_context(request, mobile_session),
    }
    return render(request, "memories/memoir_form.html", context)


def mobile_upload_item_payload(item: MobileUploadItem) -> dict[str, object]:
    return {
        "name": item.original_filename,
        "type": item.media_type,
        "size": item.size,
        "uploaded_at": timezone.localtime(item.uploaded_at).strftime("%Y-%m-%d %H:%M:%S"),
    }


@require_http_methods(["GET", "POST"])
def mobile_upload(request: HttpRequest, token: str) -> HttpResponse:
    session = get_object_or_404(
        MobileUploadSession.objects.select_related("memoir", "owner").prefetch_related("items"),
        token=token,
    )
    errors: list[str] = []
    uploaded_count = 0

    if session.is_active and request.method == "POST":
        classified_uploads = []
        for upload in request.FILES.getlist("media"):
            classification = classify_upload(upload)
            if classification is None:
                errors.append(f"不支持的文件类型：{upload.name}")
            else:
                classified_uploads.append((upload, classification))

        if not request.FILES.getlist("media"):
            errors.append("请选择照片或视频。")

        if not errors:
            if session.mode == MobileUploadSession.Mode.EDIT:
                if session.memoir is None:
                    errors.append("这个上传链接无法绑定到回忆。")
                else:
                    for upload, classification in classified_uploads:
                        media_type, mime_type = classification
                        media = save_upload(session.memoir, upload, classification)
                        MobileUploadItem.objects.create(
                            session=session,
                            media=media,
                            original_filename=upload.name,
                            media_type=media_type,
                            mime_type=mime_type,
                            size=upload.size,
                        )
            else:
                for upload, (media_type, mime_type) in classified_uploads:
                    MobileUploadItem.objects.create(
                        session=session,
                        file=upload,
                        original_filename=upload.name,
                        media_type=media_type,
                        mime_type=mime_type,
                        size=upload.size,
                    )
            uploaded_count = len(classified_uploads)

    status_code = 410 if not session.is_active else 200
    context = {
        "mobile_upload_session": session,
        "mobile_upload_items": session.items.all(),
        "errors": errors,
        "uploaded_count": uploaded_count,
    }
    return render(request, "memories/mobile_upload.html", context, status=status_code)


@login_required
@require_http_methods(["GET"])
def mobile_upload_status(request: HttpRequest, token: str) -> JsonResponse:
    session = get_object_or_404(
        MobileUploadSession.objects.prefetch_related("items"),
        token=token,
        owner=request.user,
    )
    items = [mobile_upload_item_payload(item) for item in session.items.all()]
    return JsonResponse(
        {
            "active": session.is_active,
            "expired": session.is_expired,
            "consumed": session.is_consumed,
            "count": len(items),
            "items": items,
        }
    )


@login_required
@require_POST
def memoir_delete(request: HttpRequest, pk) -> HttpResponse:
    memoir = get_object_or_404(Memoir, pk=pk, owner=request.user)
    memoir.delete()
    messages.success(request, "已删除这段回忆。")
    return redirect("memoir_list")


@login_required
def protected_media(request: HttpRequest, file_path: str) -> HttpResponse:
    media = get_object_or_404(MemoirMedia.objects.select_related("memoir"), file=file_path)
    if media.memoir.owner_id != request.user.id and not request.user.is_staff:
        raise Http404

    media_root = Path(settings.MEDIA_ROOT).resolve()
    target = (media_root / media.file.name).resolve()
    try:
        target.relative_to(media_root)
    except ValueError as exc:
        raise Http404 from exc

    if not target.exists() or not target.is_file():
        raise Http404

    content_type = media.mime_type or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target.open("rb"), content_type=content_type)
