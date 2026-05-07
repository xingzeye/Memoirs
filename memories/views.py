from __future__ import annotations

import base64
import json
import mimetypes
import re
from datetime import timedelta
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm
from django.core.exceptions import RequestDataTooBig, SuspiciousOperation
from django.core.files.base import File
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404, HttpRequest, HttpResponse, JsonResponse, StreamingHttpResponse
from django.http.multipartparser import MultiPartParserError
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.http import content_disposition_header
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
BYTE_RANGE_PATTERN = re.compile(r"^bytes=(\d*)-(\d*)$")
MEDIA_STREAM_CHUNK_SIZE = 64 * 1024
THUMBNAIL_MAX_SIZE = (720, 720)


UPLOAD_FAILURE_MESSAGE = "视频或照片上传失败。文件可能太大，或服务器临时存储空间不足。请先压缩视频后再试。"


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


def media_file_path(file_name: str) -> Path:
    media_root = Path(settings.MEDIA_ROOT).resolve()
    target = (media_root / file_name).resolve()
    try:
        target.relative_to(media_root)
    except ValueError as exc:
        raise Http404 from exc
    if not target.exists() or not target.is_file():
        raise Http404
    return target


def parse_byte_range(range_header: str, file_size: int) -> tuple[int, int] | None:
    match = BYTE_RANGE_PATTERN.match(range_header.strip())
    if not match or file_size < 1:
        return None

    start_text, end_text = match.groups()
    if not start_text and not end_text:
        return None

    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
        if start >= file_size:
            return None
        end = min(end, file_size - 1)
        if start > end:
            return None
        return start, end

    suffix_length = int(end_text)
    if suffix_length < 1:
        return None
    start = max(file_size - suffix_length, 0)
    return start, file_size - 1


def iter_file_range(target: Path, start: int, length: int):
    with target.open("rb") as file_handle:
        file_handle.seek(start)
        remaining = length
        while remaining > 0:
            chunk = file_handle.read(min(MEDIA_STREAM_CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def add_private_media_headers(response: HttpResponse, file_size: int) -> HttpResponse:
    response["Accept-Ranges"] = "bytes"
    response["Cache-Control"] = "private, max-age=86400"
    response["X-Content-Type-Options"] = "nosniff"
    if "Content-Length" not in response:
        response["Content-Length"] = str(file_size)
    return response


def file_response_with_range(
    request: HttpRequest,
    target: Path,
    content_type: str,
    download_name: str = "",
    as_attachment: bool = False,
) -> HttpResponse:
    file_size = target.stat().st_size
    range_header = request.headers.get("Range", "").strip()
    if range_header:
        byte_range = parse_byte_range(range_header, file_size)
        if byte_range is None:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{file_size}"
            response["Content-Length"] = "0"
            return add_private_media_headers(response, file_size)

        start, end = byte_range
        length = end - start + 1
        response = StreamingHttpResponse(
            iter_file_range(target, start, length),
            status=206,
            content_type=content_type,
        )
        response["Content-Length"] = str(length)
        response["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        if as_attachment and download_name:
            response["Content-Disposition"] = content_disposition_header(True, download_name)
        return add_private_media_headers(response, file_size)

    response = FileResponse(
        target.open("rb"),
        content_type=content_type,
        as_attachment=as_attachment,
        filename=download_name if as_attachment else "",
    )
    return add_private_media_headers(response, file_size)


def thumbnail_cache_path(media: MemoirMedia, source_path: Path) -> Path:
    stat = source_path.stat()
    thumb_dir = Path(settings.MEDIA_ROOT).resolve() / ".thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    return thumb_dir / f"{media.id}-{int(stat.st_mtime)}-{stat.st_size}.webp"


def ensure_media_thumbnail(media: MemoirMedia, source_path: Path) -> Path | None:
    if media.media_type != MemoirMedia.MediaType.IMAGE:
        return None

    target = thumbnail_cache_path(media, source_path)
    if target.exists() and target.is_file():
        return target

    try:
        from PIL import Image, ImageOps

        with Image.open(source_path) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGB")
            image.save(target, "WEBP", quality=78, method=6)
    except Exception:
        return None
    return target


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
        "mediaGallery": reverse("media_gallery"),
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
    extra_context: dict[str, object] | None = None,
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
            **(extra_context or {}),
        },
        status=status,
    )


def serialize_media(request: HttpRequest, media: MemoirMedia, memoir: Memoir | None = None) -> dict[str, object]:
    thumbnail_url = (
        reverse("protected_media_thumbnail", kwargs={"media_id": media.id})
        if media.media_type == MemoirMedia.MediaType.IMAGE
        else ""
    )
    payload = {
        "id": media.id,
        "url": media.protected_url,
        "absoluteUrl": absolute_or_relative_url(request, media.protected_url),
        "thumbnailUrl": thumbnail_url,
        "downloadUrl": f"{media.protected_url}?download=1",
        "type": media.media_type,
        "name": media.original_filename,
        "mimeType": media.mime_type,
        "size": media.size,
        "uploadedAt": timezone.localtime(media.uploaded_at).isoformat(),
    }
    source_memoir = memoir or getattr(media, "memoir", None)
    if source_memoir is not None:
        payload.update(
            {
                "memoirId": str(source_memoir.pk),
                "memoirTitle": source_memoir.title,
                "memoirUrl": reverse("memoir_detail", kwargs={"pk": source_memoir.pk}),
                "memoryDate": source_memoir.memory_date.isoformat() if source_memoir.memory_date else "",
                "dateLabel": source_memoir.memory_date.strftime("%Y-%m-%d") if source_memoir.memory_date else "未记录日期",
                "location": source_memoir.location,
                "mood": source_memoir.mood,
            }
        )
    return payload


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
        "isDeleted": memoir.is_deleted,
        "deletedAt": timezone.localtime(memoir.deleted_at).isoformat() if memoir.deleted_at else "",
        "mediaCount": len(media_items),
        "media": [serialize_media(request, media, memoir) for media in media_items],
        "urls": {
            "detail": reverse("memoir_detail", kwargs={"pk": memoir.pk}),
            "edit": reverse("memoir_update", kwargs={"pk": memoir.pk}),
            "delete": reverse("memoir_delete", kwargs={"pk": memoir.pk}),
            "restore": reverse("memoir_restore", kwargs={"pk": memoir.pk}),
            "destroy": reverse("memoir_destroy", kwargs={"pk": memoir.pk}),
            "api": reverse("api_memoir_detail", kwargs={"pk": memoir.pk}),
            "apiDelete": reverse("api_memoir_delete", kwargs={"pk": memoir.pk}),
            "apiRestore": reverse("api_memoir_restore", kwargs={"pk": memoir.pk}),
            "apiDestroy": reverse("api_memoir_destroy", kwargs={"pk": memoir.pk}),
        },
    }


def memoir_collection_payload(request: HttpRequest) -> dict[str, object]:
    query = request.GET.get("q", "").strip()
    mood = request.GET.get("mood", "").strip()
    showing_deleted = request.GET.get("deleted") == "1"

    memoirs = Memoir.objects.filter(
        owner=request.user,
        deleted_at__isnull=not showing_deleted,
    ).prefetch_related("media_items")
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
        Memoir.objects.filter(owner=request.user, deleted_at__isnull=not showing_deleted)
        .exclude(mood="")
        .order_by("mood")
        .values_list("mood", flat=True)
        .distinct()
    )
    active_memoirs = Memoir.objects.filter(owner=request.user, deleted_at__isnull=True)
    deleted_memoirs = Memoir.objects.filter(owner=request.user, deleted_at__isnull=False)
    all_media = MemoirMedia.objects.filter(memoir__owner=request.user, memoir__deleted_at__isnull=True)
    return {
        "memoirs": [serialize_memoir(request, memoir) for memoir in memoirs],
        "query": query,
        "activeMood": mood,
        "showingDeleted": showing_deleted,
        "moodChoices": mood_choices,
        "stats": {
            "memoirs": active_memoirs.count(),
            "deletedMemoirs": deleted_memoirs.count(),
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


def media_gallery_payload(request: HttpRequest) -> dict[str, object]:
    media_type = request.GET.get("type", "").strip()
    if media_type not in {MemoirMedia.MediaType.IMAGE, MemoirMedia.MediaType.VIDEO}:
        media_type = ""
    year = request.GET.get("year", "").strip()
    if year and (not year.isdigit() or len(year) != 4):
        year = ""
    location = request.GET.get("location", "").strip()

    base_media = MemoirMedia.objects.select_related("memoir").filter(
        memoir__owner=request.user,
        memoir__deleted_at__isnull=True,
    )
    media_items = base_media
    if media_type:
        media_items = media_items.filter(media_type=media_type)
    if year:
        media_items = media_items.filter(memoir__memory_date__year=int(year))
    if location:
        media_items = media_items.filter(memoir__location=location)
    media_items = media_items.order_by("-memoir__memory_date", "-uploaded_at", "-id")

    year_choices = [
        str(value)
        for value in base_media.exclude(memoir__memory_date__isnull=True)
        .order_by("-memoir__memory_date__year")
        .values_list("memoir__memory_date__year", flat=True)
        .distinct()
    ]
    location_choices = list(
        base_media.exclude(memoir__location="")
        .order_by("memoir__location")
        .values_list("memoir__location", flat=True)
        .distinct()
    )
    media_payload = [serialize_media(request, media) for media in media_items]
    groups: list[dict[str, object]] = []
    group_index: dict[str, dict[str, object]] = {}
    for item in media_payload:
        memory_date = str(item.get("memoryDate") or "")
        group_key = memory_date or "undated"
        if group_key not in group_index:
            group = {
                "key": group_key,
                "label": str(item.get("dateLabel") or "未记录日期"),
                "date": memory_date,
                "count": 0,
                "mediaIds": [],
            }
            group_index[group_key] = group
            groups.append(group)
        group = group_index[group_key]
        group["count"] = int(group["count"]) + 1
        group["mediaIds"].append(item["id"])

    return {
        "media": media_payload,
        "groups": groups,
        "filters": {
            "type": media_type,
            "year": year,
            "location": location,
        },
        "filterOptions": {
            "years": year_choices,
            "locations": location_choices,
            "types": [
                {"value": "", "label": "全部"},
                {"value": MemoirMedia.MediaType.IMAGE, "label": "照片"},
                {"value": MemoirMedia.MediaType.VIDEO, "label": "视频"},
            ],
        },
        "stats": {
            "media": media_items.count(),
            "photos": media_items.filter(media_type=MemoirMedia.MediaType.IMAGE).count(),
            "videos": media_items.filter(media_type=MemoirMedia.MediaType.VIDEO).count(),
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
    payload = memoir_collection_payload(request)
    media_preload_urls = []
    for memoir in payload["memoirs"]:
        for media in memoir["media"]:
            if media["type"] != MemoirMedia.MediaType.IMAGE:
                continue
            media_preload_urls.append(media["thumbnailUrl"] or media["url"])
            if len(media_preload_urls) >= 8:
                break
        if len(media_preload_urls) >= 8:
            break
    return render_app(
        request,
        "memories/memoir_list.html",
        "archive",
        payload,
        extra_context={"media_preload_urls": media_preload_urls},
    )


@login_required
@ensure_csrf_cookie
def media_gallery(request: HttpRequest) -> HttpResponse:
    return render_app(
        request,
        "memories/media_gallery.html",
        "media-gallery",
        media_gallery_payload(request),
    )


@login_required
@ensure_csrf_cookie
def memoir_detail(request: HttpRequest, pk) -> HttpResponse:
    memoir = get_object_or_404(
        Memoir.objects.prefetch_related("media_items"),
        pk=pk,
        owner=request.user,
        deleted_at__isnull=True,
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
        deleted_at__isnull=True,
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
    if session.mode == MobileUploadSession.Mode.EDIT and session.memoir and session.memoir.deleted_at:
        raise Http404
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
    memoir = get_object_or_404(Memoir, pk=pk, owner=request.user, deleted_at__isnull=True)
    memoir.soft_delete()
    messages.success(request, "已将这段回忆移入回收站。")
    return redirect("memoir_list")


@login_required
@require_POST
def memoir_restore(request: HttpRequest, pk) -> HttpResponse:
    memoir = get_object_or_404(Memoir, pk=pk, owner=request.user, deleted_at__isnull=False)
    memoir.restore()
    messages.success(request, "已恢复这段回忆。")
    return redirect("memoir_list")


@login_required
@require_POST
def memoir_destroy(request: HttpRequest, pk) -> HttpResponse:
    memoir = get_object_or_404(Memoir, pk=pk, owner=request.user, deleted_at__isnull=False)
    memoir.delete()
    messages.success(request, "已永久删除这段回忆。")
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
        deleted_at__isnull=True,
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
    memoir = get_object_or_404(Memoir, pk=pk, owner=request.user, deleted_at__isnull=True)
    memoir.soft_delete()
    return JsonResponse({"ok": True, "redirect": reverse("memoir_list")})


@login_required
@require_POST
def api_memoir_restore(request: HttpRequest, pk) -> JsonResponse:
    memoir = get_object_or_404(Memoir.objects.prefetch_related("media_items"), pk=pk, owner=request.user, deleted_at__isnull=False)
    memoir.restore()
    return JsonResponse({"memoir": serialize_memoir(request, memoir), "redirect": reverse("memoir_list")})


@login_required
@require_POST
def api_memoir_destroy(request: HttpRequest, pk) -> JsonResponse:
    memoir = get_object_or_404(Memoir, pk=pk, owner=request.user, deleted_at__isnull=False)
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
        memoir = get_object_or_404(Memoir, pk=memoir_id, owner=request.user, deleted_at__isnull=True)

    session = create_mobile_upload_session(request, mode, memoir)
    return JsonResponse({"mobileUpload": mobile_upload_session_payload(request, session)}, status=201)


@login_required
def protected_media(request: HttpRequest, file_path: str) -> HttpResponse:
    media = get_object_or_404(MemoirMedia.objects.select_related("memoir"), file=file_path)
    if media.memoir.owner_id != request.user.id and not request.user.is_staff:
        raise Http404

    target = media_file_path(media.file.name)
    content_type = media.mime_type or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    as_attachment = request.GET.get("download") == "1"
    download_name = media.original_filename or target.name
    return file_response_with_range(request, target, content_type, download_name, as_attachment)


@login_required
def protected_media_thumbnail(request: HttpRequest, media_id: int) -> HttpResponse:
    media = get_object_or_404(MemoirMedia.objects.select_related("memoir"), id=media_id)
    if media.memoir.owner_id != request.user.id and not request.user.is_staff:
        raise Http404
    if media.media_type != MemoirMedia.MediaType.IMAGE:
        raise Http404

    source_path = media_file_path(media.file.name)
    thumbnail_path = ensure_media_thumbnail(media, source_path)
    if thumbnail_path is None:
        content_type = media.mime_type or mimetypes.guess_type(source_path.name)[0] or "application/octet-stream"
        return file_response_with_range(request, source_path, content_type)
    return file_response_with_range(request, thumbnail_path, "image/webp")
