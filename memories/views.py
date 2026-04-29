from __future__ import annotations

import mimetypes
from pathlib import Path

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404, HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import MemoirForm
from .models import Memoir, MemoirMedia


IMAGE_EXTENSIONS = {".apng", ".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".m4v", ".mov", ".mp4", ".mpeg", ".webm"}


def classify_upload(upload) -> tuple[str, str] | None:
    mime_type = upload.content_type or mimetypes.guess_type(upload.name)[0] or ""
    suffix = Path(upload.name).suffix.lower()
    if mime_type.startswith("image/") or suffix in IMAGE_EXTENSIONS:
        return MemoirMedia.MediaType.IMAGE, mime_type
    if mime_type.startswith("video/") or suffix in VIDEO_EXTENSIONS:
        return MemoirMedia.MediaType.VIDEO, mime_type
    return None


def collect_uploads(request: HttpRequest, form: MemoirForm) -> list[tuple[object, tuple[str, str]]]:
    classified_uploads = []
    for upload in request.FILES.getlist("media"):
        classification = classify_upload(upload)
        if classification is None:
            form.add_error(None, f"不支持的文件类型：{upload.name}")
        else:
            classified_uploads.append((upload, classification))
    return classified_uploads


def save_uploads(memoir: Memoir, classified_uploads: list[tuple[object, tuple[str, str]]]) -> None:
    for upload, (media_type, mime_type) in classified_uploads:
        MemoirMedia.objects.create(
            memoir=memoir,
            file=upload,
            original_filename=upload.name,
            media_type=media_type,
            mime_type=mime_type,
            size=upload.size,
        )


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
    if request.method == "POST":
        form = MemoirForm(request.POST)
        classified_uploads = collect_uploads(request, form)

        if form.is_valid():
            memoir = form.save(commit=False)
            memoir.owner = request.user
            memoir.save()
            save_uploads(memoir, classified_uploads)
            messages.success(request, "已保存这段回忆。")
            return redirect("memoir_list")
    else:
        form = MemoirForm()

    return render(request, "memories/memoir_form.html", {"form": form, "mode": "create"})


@login_required
def memoir_update(request: HttpRequest, pk) -> HttpResponse:
    memoir = get_object_or_404(
        Memoir.objects.prefetch_related("media_items"),
        pk=pk,
        owner=request.user,
    )

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
            messages.success(request, "已更新这段回忆。")
            return redirect("memoir_list")
    else:
        form = MemoirForm(instance=memoir)

    context = {
        "form": form,
        "memoir": memoir,
        "mode": "edit",
        "existing_media": memoir.media_items.all(),
    }
    return render(request, "memories/memoir_form.html", context)


@login_required
@require_POST
def memoir_delete(request: HttpRequest, pk) -> HttpResponse:
    memoir = get_object_or_404(Memoir, pk=pk, owner=request.user)
    memoir.delete()
    messages.success(request, "已删除这段回忆。")
    return redirect("memoir_list")


@login_required
def protected_media(request: HttpRequest, file_path: str) -> FileResponse:
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
