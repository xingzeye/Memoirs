from django.contrib import admin
from django.utils.html import format_html

from .models import Memoir, MemoirMedia


class MemoirMediaInline(admin.TabularInline):
    model = MemoirMedia
    extra = 0
    fields = ("file", "media_type", "original_filename", "mime_type", "size", "preview")
    readonly_fields = ("original_filename", "mime_type", "size", "preview")

    def preview(self, obj: MemoirMedia) -> str:
        if not obj.pk or not obj.file:
            return "-"
        if obj.media_type == MemoirMedia.MediaType.IMAGE:
            return format_html('<img src="{}" style="height:72px;border-radius:6px;" />', obj.protected_url)
        return format_html('<a href="{}" target="_blank">打开视频</a>', obj.protected_url)

    preview.short_description = "预览"


@admin.register(Memoir)
class MemoirAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "memory_date", "mood", "location", "media_count", "deleted_at", "created_at")
    list_filter = ("deleted_at", "mood", "memory_date", "created_at", "updated_at")
    search_fields = ("title", "story", "location", "mood", "owner__username")
    readonly_fields = ("id", "created_at", "updated_at")
    inlines = (MemoirMediaInline,)
    date_hierarchy = "created_at"
    ordering = ("-memory_date", "-created_at")

    def save_model(self, request, obj: Memoir, form, change) -> None:
        if not obj.owner_id:
            obj.owner = request.user
        super().save_model(request, obj, form, change)

    def media_count(self, obj: Memoir) -> int:
        return obj.media_items.count()

    media_count.short_description = "媒体数"


@admin.register(MemoirMedia)
class MemoirMediaAdmin(admin.ModelAdmin):
    list_display = ("original_filename", "memoir", "media_type", "mime_type", "size", "uploaded_at")
    list_filter = ("media_type", "uploaded_at")
    search_fields = ("original_filename", "memoir__title", "mime_type")
    readonly_fields = ("uploaded_at", "preview")

    def preview(self, obj: MemoirMedia) -> str:
        if not obj.pk or not obj.file:
            return "-"
        if obj.media_type == MemoirMedia.MediaType.IMAGE:
            return format_html('<img src="{}" style="max-width:360px;border-radius:8px;" />', obj.protected_url)
        return format_html('<video src="{}" controls style="max-width:420px;border-radius:8px;"></video>', obj.protected_url)

    preview.short_description = "预览"
