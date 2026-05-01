import django.db.models.deletion
import memories.models
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("memories", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="MobileUploadSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token", models.CharField(default=memories.models.generate_mobile_upload_token, max_length=96, unique=True)),
                ("mode", models.CharField(choices=[("create", "Create"), ("edit", "Edit")], max_length=10)),
                ("expires_at", models.DateTimeField()),
                ("is_consumed", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "memoir",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mobile_upload_sessions",
                        to="memories.memoir",
                    ),
                ),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mobile_upload_sessions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="MobileUploadItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "file",
                    models.FileField(
                        blank=True,
                        max_length=500,
                        upload_to=memories.models.mobile_upload_item_upload_to,
                    ),
                ),
                ("original_filename", models.CharField(blank=True, max_length=255)),
                (
                    "media_type",
                    models.CharField(
                        blank=True,
                        choices=[("image", "图片"), ("video", "视频")],
                        max_length=10,
                    ),
                ),
                ("mime_type", models.CharField(blank=True, max_length=120)),
                ("size", models.PositiveBigIntegerField(default=0)),
                ("uploaded_at", models.DateTimeField(auto_now_add=True)),
                (
                    "media",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="+",
                        to="memories.memoirmedia",
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="memories.mobileuploadsession",
                    ),
                ),
            ],
            options={
                "ordering": ["uploaded_at", "id"],
            },
        ),
    ]
