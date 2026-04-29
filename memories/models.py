from __future__ import annotations

import uuid
import mimetypes
from pathlib import Path

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.urls import reverse
from django.utils.text import get_valid_filename


IMAGE_EXTENSIONS = {".apng", ".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".m4v", ".mov", ".mp4", ".mpeg", ".webm"}


def memoir_media_upload_to(instance: "MemoirMedia", filename: str) -> str:
    safe_name = get_valid_filename(Path(filename).name) or "memory"
    memoir_id = instance.memoir_id or uuid.uuid4()
    return f"memoirs/{memoir_id}/{uuid.uuid4().hex}-{safe_name}"


class Memoir(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField("标题", max_length=120)
    story = models.TextField("正文", blank=True)
    memory_date = models.DateField("日期", blank=True, null=True)
    location = models.CharField("地点", max_length=120, blank=True)
    mood = models.CharField("心情标签", max_length=60, blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name="上传用户", related_name="memoirs", on_delete=models.CASCADE)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "回忆"
        verbose_name_plural = "回忆"
        ordering = ["-memory_date", "-created_at"]

    def __str__(self) -> str:
        return self.title


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


@receiver(post_delete, sender=MemoirMedia)
def delete_media_file(sender, instance: MemoirMedia, **kwargs) -> None:
    if instance.file:
        instance.file.delete(save=False)
