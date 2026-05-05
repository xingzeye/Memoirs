from __future__ import annotations

import base64
import json
import mimetypes
from datetime import timedelta
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm
from django.core.files.base import File
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404, HttpRequest, HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods, require_POST

from .forms import MemoirForm, RegisterForm
from .models import Memoir, MemoirMedia, MobileUploadItem, MobileUploadSession


try:
    import qrcode
except ImportError:  # pragma: no cover - dependency is declared, this keeps local checks usable before install.
    qrcode = None


IMAGE_EXTENSIONS = {".apng", ".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".m4v", ".mov", ".mp4", ".mpeg", ".webm"}


def wants_json(request: HttpRequest) -> bool:
    accept = request.headers.get("Accept", "")
    return "application/json" in accept or request.headers.get("X-Requested-With") == "XMLHttpRequest"


def read_json_body(request: HttpRequest) -> dict[str, object]:
    if not request.body:
        return {}
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def absolute_or_relative_url(request: HttpRequest, url: str) -> str:
    if url.startswith(("http://", "https://", "data:")):
        return url
    return request.build_absolute_uri(url)


def serialize_user(request: HttpRequest) -> dict[str, object] | None:
    user = request.user
    if not user.is_authenticated:
        return None
    return {
        "id": user.id,
        "username": user.get_username(),
        "isStaff": user.is_staff,
    }


def app_routes() -> dict[str, str]:
    routes = {
        "session": reverse("api_session"),
        "login": reverse("api_login"),
        "logout": reverse("api_logout"),
        "memoirs": reverse("api_memoirs"),
        "mobileUploadSessions": reverse("api_mobile_upload_sessions"),
        "memoirList": reverse("memoir_list"),
        "memoirCreate": reverse("memoir_create"),
        "loginPage": reverse("login"),
    }
    if settings.ALLOW_PUBLIC_REGISTRATION:
        routes["register"] = reverse("api_register")
        routes["registerPage"] = reverse("register")
    return routes


def session_payload(request: HttpRequest) -> dict[str, object]:
    return {
        "user": serialize_user(request),
        "allowPublicRegistration": settings.ALLOW_PUBLIC_REGISTRATION,
        "csrfToken": get_token(request),
        "routes": app_routes(),
        "uploadLimits": {
            "maxRequestBytes": settings.DATA_UPLOAD_MAX_MEMORY_SIZE,
            "maxMemoryFileBytes": settings.FILE_UPLOAD_MAX_MEMORY_SIZE,
        },
    }


def form_error_payload(form) -> dict[str, list[str]]:
    errors: dict[str, list[str]] = {}
    for field, field_errors in form.errors.items():
        errors[field] = [str(error) for error in field_errors]
    return errors


def render_app(
    request: HttpRequest,
    template_name: str,
    page: str,
    payload: dict[str, object] | None = None,
    status: int = 200,
) -> HttpResponse:
    initial_data = {
        "page": page,
        "session": session_payload(request),
        "payload": payload or {},
    }
    return render(
        request,
        template_name,
        {
            "app_page": page,
            "app_initial_data": initial_data,
        },
        status=status,
    )


def serialize_media(request: HttpRequest, media: MemoirMedia) -> dict[str, object]:
    return {
        "id": media.id,
        "url": media.protected_url,
        "absoluteUrl": absolute_or_relative_url(request, media.protected_url),
        "type": media.media_type,
        "name": media.original_filename,
        "mimeType": media.mime_type,
        "size": media.size,
        "uploadedAt": timezone.localtime(media.uploaded_at).isoformat(),
    }


def serialize_memoir(request: HttpRequest, memoir: Memoir) -> dict[str, object]:
    media_items = list(memoir.media_items.all())
    return {
        "id": str(memoir.pk),
        "title": memoir.title,
        "story": memoir.story,
        "excerpt": memoir.story[:96],
        "memoryDate": memoir.memory_date.isoformat() if memoir.memory_date else "",
        "dateLabel": memoir.memory_date.strftime("%Y-%m-%d") if memoir.memory_date else "某一天",
        "location": memoir.location,
        "mood": memoir.mood,
        "createdAt": timezone.localtime(memoir.created_at).isoformat(),
        "updatedAt": timezone.localtime(memoir.updated_at).isoformat(),
        "mediaCount": len(media_items),
        "media": [serialize_media(request, media) for media in media_items],
        "urls": {
            "detail": reverse("memoir_detail", kwargs={"pk": memoir.pk}),
            "edit": reverse("memoir_update", kwargs={"pk": memoir.pk}),
            "delete": reverse("memoir_delete", kwargs={"pk": memoir.pk}),
            "api": reverse("api_memoir_detail", kwargs={"pk": memoir.pk}),
            "apiDelete": reverse("api_memoir_delete", kwargs={"pk": memoir.pk}),
        },
    }


def memoir_collection_payload(request: HttpRequest) -> dict[str, object]:
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

    mood_choices = list(
        Memoir.objects.filter(owner=request.user)
        .exclude(mood="")
        .order_by("mood")
        .values_list("mood", flat=True)
        .distinct()
    )
    all_memoirs = Memoir.objects.filter(owner=request.user)
    all_media = MemoirMedia.objects.filter(memoir__owner=request.user)
    return {
        "memoirs": [serialize_memoir(request, memoir) for memoir in memoirs],
        "query": query,
        "activeMood": mood,
        "moodChoices": mood_choices,
        "stats": {
            "memoirs": all_memoirs.count(),
            "media": all_media.count(),
            "photos": all_media.filter(media_type=MemoirMedia.MediaType.IMAGE).count(),
            "videos": all_media.filter(media_type=MemoirMedia.MediaType.VIDEO).count(),
        },
        "labels": {
            "edit": "修改",
            "delete": "删除",
            "create": "新增回忆",
            "search": "搜索标题、地点、正文或心情",
        },
    }


def mobile_upload_item_payload(item: MobileUploadItem) -> dict[str, object]:
    return {
        "id": item.id,
        "name": item.original_filename,
        "type": item.media_type,
        "size": item.size,
        "uploaded_at": timezone.localtime(item.uploaded_at).strftime("%Y-%m-%d %H:%M:%S"),
        "preview_url": reverse(
            "mobile_upload_item_preview",
            kwargs={"token": item.session.token, "item_id": item.id},
        ),
    }


def mobile_upload_session_payload(request: HttpRequest, session: MobileUploadSession) -> dict[str, object]:
    upload_url = mobile_upload_url(request, session)
    return {
        "token": session.token,
        "mode": session.mode,
        "memoirId": str(session.memoir_id) if session.memoir_id else "",
        "memoirTitle": session.memoir.title if session.memoir_id else "",
        "uploadUrl": upload_url,
        "qrDataUri": mobile_upload_qr_data_uri(upload_url),
        "statusUrl": reverse("mobile_upload_status", kwargs={"token": session.token}),
        "active": session.is_active,
        "expired": session.is_expired,
        "consumed": session.is_consumed,
        "expiresAt": timezone.localtime(session.expires_at).isoformat(),
        "items": [mobile_upload_item_payload(item) for item in session.items.all()],
    }


def editor_form_payload(form: MemoirForm) -> dict[str, object]:
    def field_value(name: str) -> str:
        value = form[name].value()
        if value is None:
            return ""
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return str(value)

    return {
        "values": {
            "title": field_value("title"),
            "memory_date": field_value("memory_date"),
            "location": field_value("location"),
            "mood": field_value("mood"),
            "story": field_value("story"),
        },
        "errors": form_error_payload(form),
    }


def editor_payload(
    request: HttpRequest,
    form: MemoirForm,
    mode: str,
    mobile_session: MobileUploadSession,
    memoir: Memoir | None = None,
) -> dict[str, object]:
    return {
        "mode": mode,
        "memoir": serialize_memoir(request, memoir) if memoir else None,
        "form": editor_form_payload(form),
        "mobileUpload": mobile_upload_session_payload(request, mobile_session),
        "existingMedia": [serialize_media(request, media) for media in memoir.media_items.all()] if memoir else [],
        "submitUrl": reverse("memoir_update", kwargs={"pk": memoir.pk}) if memoir else reverse("memoir_create"),
        "apiSubmitUrl": reverse("api_memoir_detail", kwargs={"pk": memoir.pk}) if memoir else reverse("api_memoirs"),
    }


def auth_payload(request: HttpRequest, mode: str, form=None, next_url: str = "") -> dict[str, object]:
    payload = {
        "mode": mode,
        "next": next_url,
        "allowPublicRegistration": settings.ALLOW_PUBLIC_REGISTRATION,
        "errors": form_error_payload(form) if form is not None else {},
        "loginUrl": reverse("login"),
        "switchLabel": "立即注册" if mode == "login" else "返回登录",
    }
    if settings.ALLOW_PUBLIC_REGISTRATION:
        payload["registerUrl"] = reverse("register")
    return payload


@ensure_csrf_cookie
def login_page(request: HttpRequest) -> HttpResponse:
    if request.user.is_authenticated:
        return redirect("memoir_list")

    next_url = request.POST.get("next") or request.GET.get("next", "")
    if request.method == "POST":
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            login(request, form.get_user())
            return redirect(next_url or "memoir_list")
    else:
        form = AuthenticationForm(request)

    return render_app(
        request,
        "registration/login.html",
        "auth",
        auth_payload(request, "login", form, next_url),
    )


@ensure_csrf_cookie
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

    return render_app(
        request,
        "registration/register.html",
        "auth",
        auth_payload(request, "register", form),
    )


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


def mobile_upload_page_payload(
    request: HttpRequest,
    session: MobileUploadSession,
    errors: list[str] | None = None,
    uploaded_count: int = 0,
) -> dict[str, object]:
    return {
        "mobileUpload": mobile_upload_session_payload(request, session),
        "errors": errors or [],
        "uploadedCount": uploaded_count,
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
@ensure_csrf_cookie
def memoir_list(request: HttpRequest) -> HttpResponse:
    return render_app(
        request,
        "memories/memoir_list.html",
        "archive",
        memoir_collection_payload(request),
    )


@login_required
@ensure_csrf_cookie
def memoir_detail(request: HttpRequest, pk) -> HttpResponse:
    memoir = get_object_or_404(
        Memoir.objects.prefetch_related("media_items"),
        pk=pk,
        owner=request.user,
    )
    return render_app(
        request,
        "memories/memoir_detail.html",
        "detail",
        {"memoir": serialize_memoir(request, memoir)},
    )


@login_required
@ensure_csrf_cookie
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

    return render_app(
        request,
        "memories/memoir_form.html",
        "editor",
        editor_payload(request, form, "create", mobile_session),
    )


@login_required
@ensure_csrf_cookie
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

    return render_app(
        request,
        "memories/memoir_form.html",
        "editor",
        editor_payload(request, form, "edit", mobile_session, memoir),
    )


@require_http_methods(["GET", "POST"])
@ensure_csrf_cookie
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
    payload = mobile_upload_page_payload(request, session, errors, uploaded_count)
    if wants_json(request):
        return JsonResponse(payload, status=status_code)
    return render_app(request, "memories/mobile_upload.html", "mobile-upload", payload, status=status_code)


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
@require_http_methods(["GET"])
def mobile_upload_item_preview(request: HttpRequest, token: str, item_id: int) -> FileResponse:
    session = get_object_or_404(MobileUploadSession, token=token, owner=request.user)
    item = get_object_or_404(
        MobileUploadItem.objects.select_related("media", "media__memoir"),
        id=item_id,
        session=session,
    )
    file_field = item.media.file if item.media_id else item.file
    if not file_field:
        raise Http404

    content_type = item.mime_type or mimetypes.guess_type(file_field.name)[0] or "application/octet-stream"
    return FileResponse(file_field.open("rb"), content_type=content_type)


@login_required
@require_POST
def memoir_delete(request: HttpRequest, pk) -> HttpResponse:
    memoir = get_object_or_404(Memoir, pk=pk, owner=request.user)
    memoir.delete()
    messages.success(request, "已删除这段回忆。")
    return redirect("memoir_list")


@ensure_csrf_cookie
def api_session(request: HttpRequest) -> JsonResponse:
    return JsonResponse(session_payload(request))


@require_POST
def api_login(request: HttpRequest) -> JsonResponse:
    payload = read_json_body(request)
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"errors": {"__all__": ["用户名或密码不正确。"]}}, status=400)
    login(request, user)
    return JsonResponse({"user": serialize_user(request), "redirect": reverse("memoir_list")})


@require_POST
def api_register(request: HttpRequest) -> JsonResponse:
    if not settings.ALLOW_PUBLIC_REGISTRATION:
        raise Http404
    payload = read_json_body(request)
    form = RegisterForm(payload)
    if not form.is_valid():
        return JsonResponse({"errors": form_error_payload(form)}, status=400)
    user = form.save()
    login(request, user)
    messages.success(request, "注册成功，欢迎来到你的回忆库。")
    return JsonResponse({"user": serialize_user(request), "redirect": reverse("memoir_list")}, status=201)


@login_required
@require_POST
def api_logout(request: HttpRequest) -> JsonResponse:
    logout(request)
    return JsonResponse({"redirect": reverse("login")})


@login_required
@require_http_methods(["GET", "POST"])
def api_memoirs(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        return JsonResponse(memoir_collection_payload(request))

    form = MemoirForm(request.POST)
    classified_uploads = collect_uploads(request, form)
    mobile_session = posted_mobile_upload_session(request, MobileUploadSession.Mode.CREATE)
    if not form.is_valid():
        return JsonResponse({"errors": form_error_payload(form)}, status=400)

    with transaction.atomic():
        memoir = form.save(commit=False)
        memoir.owner = request.user
        memoir.save()
        save_uploads(memoir, classified_uploads)
        if mobile_session:
            promote_mobile_upload_items(memoir, mobile_session)
    memoir = Memoir.objects.prefetch_related("media_items").get(pk=memoir.pk)
    return JsonResponse({"memoir": serialize_memoir(request, memoir), "redirect": reverse("memoir_list")}, status=201)


@login_required
@require_http_methods(["GET", "POST"])
def api_memoir_detail(request: HttpRequest, pk) -> JsonResponse:
    memoir = get_object_or_404(
        Memoir.objects.prefetch_related("media_items"),
        pk=pk,
        owner=request.user,
    )
    if request.method == "GET":
        mobile_session = create_mobile_upload_session(request, MobileUploadSession.Mode.EDIT, memoir)
        form = MemoirForm(instance=memoir)
        return JsonResponse(editor_payload(request, form, "edit", mobile_session, memoir))

    form = MemoirForm(request.POST, instance=memoir)
    classified_uploads = collect_uploads(request, form)
    media_to_delete = request.POST.getlist("delete_media")
    if not form.is_valid():
        return JsonResponse({"errors": form_error_payload(form)}, status=400)

    with transaction.atomic():
        memoir = form.save()
        if media_to_delete:
            MemoirMedia.objects.filter(
                id__in=media_to_delete,
                memoir=memoir,
                memoir__owner=request.user,
            ).delete()
        save_uploads(memoir, classified_uploads)
        token = request.POST.get("mobile_upload_token", "").strip()
        if token:
            MobileUploadSession.objects.filter(
                token=token,
                owner=request.user,
                mode=MobileUploadSession.Mode.EDIT,
                memoir=memoir,
            ).update(is_consumed=True)
    memoir = Memoir.objects.prefetch_related("media_items").get(pk=memoir.pk)
    return JsonResponse({"memoir": serialize_memoir(request, memoir), "redirect": reverse("memoir_list")})


@login_required
@require_POST
def api_memoir_delete(request: HttpRequest, pk) -> JsonResponse:
    memoir = get_object_or_404(Memoir, pk=pk, owner=request.user)
    memoir.delete()
    return JsonResponse({"ok": True, "redirect": reverse("memoir_list")})


@login_required
@require_POST
def api_mobile_upload_sessions(request: HttpRequest) -> JsonResponse:
    payload = read_json_body(request)
    mode = str(payload.get("mode", MobileUploadSession.Mode.CREATE)).strip()
    if mode not in {MobileUploadSession.Mode.CREATE, MobileUploadSession.Mode.EDIT}:
        return JsonResponse({"errors": {"mode": ["无效的上传模式。"]}}, status=400)

    memoir = None
    memoir_id = str(payload.get("memoir_id") or payload.get("memoirId") or "").strip()
    if mode == MobileUploadSession.Mode.EDIT:
        if not memoir_id:
            return JsonResponse({"errors": {"memoir_id": ["编辑模式需要回忆 ID。"]}}, status=400)
        memoir = get_object_or_404(Memoir, pk=memoir_id, owner=request.user)

    session = create_mobile_upload_session(request, mode, memoir)
    return JsonResponse({"mobileUpload": mobile_upload_session_payload(request, session)}, status=201)


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
