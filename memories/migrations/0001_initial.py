import django.db.models.deletion
import memories.models
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Memoir",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=120, verbose_name="标题")),
                ("story", models.TextField(blank=True, verbose_name="正文")),
                ("memory_date", models.DateField(blank=True, null=True, verbose_name="日期")),
                ("location", models.CharField(blank=True, max_length=120, verbose_name="地点")),
                ("mood", models.CharField(blank=True, max_length=60, verbose_name="心情标签")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="创建时间")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新时间")),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="memoirs",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="上传用户",
                    ),
                ),
            ],
            options={
                "verbose_name": "回忆",
                "verbose_name_plural": "回忆",
                "ordering": ["-memory_date", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="MemoirMedia",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "file",
                    models.FileField(max_length=500, upload_to=memories.models.memoir_media_upload_to, verbose_name="文件"),
                ),
                ("original_filename", models.CharField(blank=True, max_length=255, verbose_name="原始文件名")),
                (
                    "media_type",
                    models.CharField(
                        blank=True,
                        choices=[("image", "图片"), ("video", "视频")],
                        max_length=10,
                        verbose_name="类型",
                    ),
                ),
                ("mime_type", models.CharField(blank=True, max_length=120, verbose_name="MIME 类型")),
                ("size", models.PositiveBigIntegerField(default=0, verbose_name="大小")),
                ("uploaded_at", models.DateTimeField(auto_now_add=True, verbose_name="上传时间")),
                (
                    "memoir",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="media_items",
                        to="memories.memoir",
                        verbose_name="所属回忆",
                    ),
                ),
            ],
            options={
                "verbose_name": "媒体文件",
                "verbose_name_plural": "媒体文件",
                "ordering": ["uploaded_at", "id"],
            },
        ),
    ]
