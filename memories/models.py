from __future__ import annotations

import uuid
import mimetypes
import secrets
from pathlib import Path

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.urls import reverse
from django.utils import timezone
from django.utils.text import get_valid_filename


IMAGE_EXTENSIONS = {".apng", ".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".m4v", ".mov", ".mp4", ".mpeg", ".webm"}


def memoir_media_upload_to(instance: "MemoirMedia", filename: str) -> str:
    safe_name = get_valid_filename(Path(filename).name) or "memory"
    memoir_id = instance.memoir_id or uuid.uuid4()
    return f"memoirs/{memoir_id}/{uuid.uuid4().hex}-{safe_name}"


def generate_mobile_upload_token() -> str:
    return secrets.token_urlsafe(32)


def mobile_upload_item_upload_to(instance: "MobileUploadItem", filename: str) -> str:
    safe_name = get_valid_filename(Path(filename).name) or "mobile-upload"
    token = instance.session.token if instance.session_id else generate_mobile_upload_token()
    return f"mobile-uploads/{token}/{uuid.uuid4().hex}-{safe_name}"


class Memoir(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField("标题", max_length=120)
    story = models.TextField("正文", blank=True)
    memory_date = models.DateField("日期", blank=True, null=True)
    location = models.CharField("地点", max_length=120, blank=True)
    mood = models.CharField("心情标签", max_length=60, blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name="上传用户", related_name="memoirs", on_delete=models.CASCADE)
    deleted_at = models.DateTimeField("删除时间", blank=True, null=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "回忆"
        verbose_name_plural = "回忆"
        ordering = ["-memory_date", "-created_at"]

    def __str__(self) -> str:
        return self.title

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    def soft_delete(self) -> None:
        if self.deleted_at is None:
            self.deleted_at = timezone.now()
            self.save(update_fields=["deleted_at", "updated_at"])

    def restore(self) -> None:
        if self.deleted_at is not None:
            self.deleted_at = None
            self.save(update_fields=["deleted_at", "updated_at"])


class MemoirMedia(models.Model):
    class MediaType(models.TextChoices):
        IMAGE = "image", "图片"
        VIDEO = "video", "视频"

    memoir = models.ForeignKey(Memoir, verbose_name="所属回忆", related_name="media_items", on_delete=models.CASCADE)
    file = models.FileField("文件", upload_to=memoir_media_upload_to, max_length=500)
    original_filename = models.CharField("原始文件名", max_length=255, blank=True)
    media_type = models.CharField("类型", max_length=10, choices=MediaType.choices, blank=True)
    mime_type = models.CharField("MIME 类型", max_length=120, blank=True)
    size = models.PositiveBigIntegerField("大小", default=0)
    uploaded_at = models.DateTimeField("上传时间", auto_now_add=True)

    class Meta:
        verbose_name = "媒体文件"
        verbose_name_plural = "媒体文件"
        ordering = ["uploaded_at", "id"]

    def __str__(self) -> str:
        return self.original_filename

    def save(self, *args, **kwargs) -> None:
        if self.file:
            file_name = Path(self.file.name).name
            mime_type = self.mime_type or mimetypes.guess_type(file_name)[0] or ""
            suffix = Path(file_name).suffix.lower()
            self.original_filename = self.original_filename or file_name
            self.mime_type = mime_type
            self.size = getattr(self.file, "size", self.size) or 0
            if not self.media_type:
                if mime_type.startswith("video/") or suffix in VIDEO_EXTENSIONS:
                    self.media_type = self.MediaType.VIDEO
                else:
                    self.media_type = self.MediaType.IMAGE
        super().save(*args, **kwargs)

    @property
    def protected_url(self) -> str:
        return reverse("protected_media", kwargs={"file_path": self.file.name})


class MobileUploadSession(models.Model):
    class Mode(models.TextChoices):
        CREATE = "create", "Create"
        EDIT = "edit", "Edit"

    token = models.CharField(max_length=96, unique=True, default=generate_mobile_upload_token)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="mobile_upload_sessions",
        on_delete=models.CASCADE,
    )
    mode = models.CharField(max_length=10, choices=Mode.choices)
    memoir = models.ForeignKey(
        Memoir,
        related_name="mobile_upload_sessions",
        on_delete=models.CASCADE,
        blank=True,
        null=True,
    )
    expires_at = models.DateTimeField()
    is_consumed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.mode}:{self.token[:8]}"

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    @property
    def is_active(self) -> bool:
        return not self.is_consumed and not self.is_expired


class MobileUploadItem(models.Model):
    session = models.ForeignKey(
        MobileUploadSession,
        related_name="items",
        on_delete=models.CASCADE,
    )
    file = models.FileField(upload_to=mobile_upload_item_upload_to, max_length=500, blank=True)
    media = models.ForeignKey(
        MemoirMedia,
        related_name="+",
        on_delete=models.CASCADE,
        blank=True,
        null=True,
    )
    original_filename = models.CharField(max_length=255, blank=True)
    media_type = models.CharField(max_length=10, choices=MemoirMedia.MediaType.choices, blank=True)
    mime_type = models.CharField(max_length=120, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at", "id"]

    def __str__(self) -> str:
        return self.original_filename


@receiver(post_delete, sender=MemoirMedia)
def delete_media_file(sender, instance: MemoirMedia, **kwargs) -> None:
    if instance.file:
        instance.file.delete(save=False)


@receiver(post_delete, sender=MobileUploadItem)
def delete_mobile_upload_item_file(sender, instance: MobileUploadItem, **kwargs) -> None:
    if instance.file:
        instance.file.delete(save=False)
