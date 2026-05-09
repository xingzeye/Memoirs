import json
import zipfile
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from .models import Memoir, MemoirMedia, MobileUploadItem, MobileUploadSession


TEST_MEDIA_ROOT = Path(__file__).resolve().parents[1] / ".test-media"


def tiny_png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (2, 2), color=(31, 117, 105)).save(buffer, "PNG")
    return buffer.getvalue()


TINY_PNG_BYTES = tiny_png_bytes()


def app_payload(response):
    return response.context["app_initial_data"]["payload"]


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class MemoirViewTests(TestCase):
    def setUp(self):
        TEST_MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
        self.user = get_user_model().objects.create_user(username="owner", password="secret12345")
        self.other_user = get_user_model().objects.create_user(username="other", password="secret12345")

    def login(self):
        self.client.login(username="owner", password="secret12345")

    def test_core_pages_require_login(self):
        for url in [
            reverse("memoir_list"),
            reverse("media_gallery"),
            reverse("memoir_create"),
            reverse("backup"),
            reverse("memoir_export"),
        ]:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 302)
            self.assertIn(reverse("login"), response["Location"])

    def test_login_page_links_to_register(self):
        response = self.client.get(reverse("login"))

        self.assertContains(response, reverse("register"))
        self.assertContains(response, '"page": "auth"')

    @override_settings(ALLOW_PUBLIC_REGISTRATION=False)
    def test_public_registration_can_be_disabled(self):
        response = self.client.get(reverse("register"))

        self.assertEqual(response.status_code, 404)

        response = self.client.get(reverse("login"))
        self.assertNotContains(response, reverse("register"))
        self.assertContains(response, '"allowPublicRegistration": false')

    def test_register_creates_user_and_logs_in(self):
        response = self.client.post(
            reverse("register"),
            {
                "username": "new_owner",
                "email": "new@example.com",
                "password1": "StrongerPass12345",
                "password2": "StrongerPass12345",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], reverse("memoir_list"))
        self.assertTrue(get_user_model().objects.filter(username="new_owner").exists())
        response = self.client.get(reverse("memoir_list"))
        self.assertEqual(response.status_code, 200)

    def test_create_page_includes_mobile_upload_session(self):
        self.login()

        response = self.client.get(reverse("memoir_create"))

        self.assertEqual(response.status_code, 200)
        session = MobileUploadSession.objects.get(owner=self.user, mode=MobileUploadSession.Mode.CREATE)
        self.assertContains(response, session.token)
        self.assertContains(response, reverse("mobile_upload", kwargs={"token": session.token}))
        self.assertContains(response, '"mobileUpload"')
        self.assertContains(response, '"uploadLimits"')

    def test_mobile_upload_create_waits_until_desktop_save(self):
        self.login()
        self.client.get(reverse("memoir_create"))
        session = MobileUploadSession.objects.get(owner=self.user, mode=MobileUploadSession.Mode.CREATE)
        self.client.logout()

        response = self.client.post(
            reverse("mobile_upload", kwargs={"token": session.token}),
            {"media": [SimpleUploadedFile("phone.jpg", b"phone image bytes", content_type="image/jpeg")]},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(MobileUploadItem.objects.filter(session=session).count(), 1)
        self.assertEqual(MemoirMedia.objects.count(), 0)

        self.login()
        response = self.client.get(reverse("mobile_upload_status", kwargs={"token": session.token}))
        self.assertEqual(response.status_code, 200)
        preview_url = response.json()["items"][0]["preview_url"]
        preview_response = self.client.get(preview_url)
        self.assertEqual(preview_response.status_code, 200)
        self.assertEqual(preview_response["Content-Type"], "image/jpeg")
        preview_response.close()

        self.client.logout()
        self.client.login(username="other", password="secret12345")
        response = self.client.get(preview_url)
        self.assertEqual(response.status_code, 404)

        self.client.logout()
        self.login()
        response = self.client.post(
            reverse("memoir_create"),
            {
                "title": "Phone backed memory",
                "story": "created from desktop",
                "memory_date": "2026-04-29",
                "location": "Desk",
                "mood": "Ready",
                "mobile_upload_token": session.token,
            },
        )

        self.assertEqual(response.status_code, 302)
        memoir = Memoir.objects.get(title="Phone backed memory")
        media = memoir.media_items.get()
        self.assertEqual(media.original_filename, "phone.jpg")
        session.refresh_from_db()
        self.assertTrue(session.is_consumed)

    def test_mobile_upload_edit_adds_media_immediately(self):
        self.login()
        memoir = Memoir.objects.create(title="Existing", owner=self.user)
        self.client.get(reverse("memoir_update", kwargs={"pk": memoir.pk}))
        session = MobileUploadSession.objects.get(
            owner=self.user,
            mode=MobileUploadSession.Mode.EDIT,
            memoir=memoir,
        )
        self.client.logout()

        response = self.client.post(
            reverse("mobile_upload", kwargs={"token": session.token}),
            {"media": [SimpleUploadedFile("phone.mp4", b"phone video bytes", content_type="video/mp4")]},
        )

        self.assertEqual(response.status_code, 200)
        media = memoir.media_items.get()
        self.assertEqual(media.media_type, MemoirMedia.MediaType.VIDEO)
        self.assertEqual(MobileUploadItem.objects.get(session=session).media, media)

    def test_mobile_upload_rejects_invalid_and_expired_tokens(self):
        response = self.client.get(reverse("mobile_upload", kwargs={"token": "missing-token"}))
        self.assertEqual(response.status_code, 404)

        session = MobileUploadSession.objects.create(
            owner=self.user,
            mode=MobileUploadSession.Mode.CREATE,
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        response = self.client.post(
            reverse("mobile_upload", kwargs={"token": session.token}),
            {"media": [SimpleUploadedFile("late.jpg", b"late image bytes", content_type="image/jpeg")]},
        )

        self.assertEqual(response.status_code, 410)
        self.assertFalse(MobileUploadItem.objects.filter(session=session).exists())

    def test_mobile_upload_status_is_owner_only(self):
        self.login()
        self.client.get(reverse("memoir_create"))
        session = MobileUploadSession.objects.get(owner=self.user, mode=MobileUploadSession.Mode.CREATE)

        self.client.logout()
        self.client.login(username="other", password="secret12345")
        response = self.client.get(reverse("mobile_upload_status", kwargs={"token": session.token}))
        self.assertEqual(response.status_code, 404)

        self.client.logout()
        self.login()
        response = self.client.get(reverse("mobile_upload_status", kwargs={"token": session.token}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 0)

    def test_create_memoir_with_media(self):
        self.login()
        upload = SimpleUploadedFile("photo.jpg", b"fake image bytes", content_type="image/jpeg")
        response = self.client.post(
            reverse("memoir_create"),
            {
                "title": "接口测试",
                "story": "upload smoke test",
                "memory_date": "2026-04-29",
                "location": "本地",
                "mood": "测试",
                "media": [upload],
            },
        )

        self.assertEqual(response.status_code, 302)
        memoir = Memoir.objects.get(title="接口测试")
        media = memoir.media_items.get()
        self.assertEqual(media.media_type, MemoirMedia.MediaType.IMAGE)
        self.assertTrue(Path(media.file.path).exists())

    def test_list_shows_edit_link(self):
        self.login()
        memoir = Memoir.objects.create(title="可修改", owner=self.user)
        MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("photo.jpg", b"photo bytes", content_type="image/jpeg"),
            original_filename="photo.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/jpeg",
            size=11,
        )
        MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("clip.mp4", b"video bytes", content_type="video/mp4"),
            original_filename="clip.mp4",
            media_type=MemoirMedia.MediaType.VIDEO,
            mime_type="video/mp4",
            size=11,
        )

        response = self.client.get(reverse("memoir_list"))

        detail_url = reverse("memoir_detail", kwargs={"pk": memoir.pk})
        self.assertContains(response, detail_url)
        self.assertContains(response, reverse("memoir_update", kwargs={"pk": memoir.pk}))
        self.assertContains(response, '"page": "archive"')
        detail_response = self.client.get(detail_url)
        self.assertEqual(detail_response.status_code, 200)
        self.assertContains(detail_response, '"page": "detail"')
        self.assertContains(detail_response, "photo.jpg")
        response = self.client.get(reverse("api_memoirs"))
        stats = response.json()["stats"]
        self.assertEqual(stats["memoirs"], 1)
        self.assertEqual(stats["media"], 2)
        self.assertEqual(stats["photos"], 1)
        self.assertEqual(stats["videos"], 1)

    def test_memoir_api_paginates_and_limits_preview_media(self):
        media_owner = None
        for index in range(25):
            memoir = Memoir.objects.create(
                title=f"Memory {index:02d}",
                memory_date=date(2026, 1, 1) + timedelta(days=index),
                owner=self.user,
            )
            if index == 24:
                media_owner = memoir
        for index in range(5):
            MemoirMedia.objects.create(
                memoir=media_owner,
                file=SimpleUploadedFile(f"preview-{index}.jpg", TINY_PNG_BYTES, content_type="image/png"),
                original_filename=f"preview-{index}.jpg",
                media_type=MemoirMedia.MediaType.IMAGE,
                mime_type="image/png",
                size=len(TINY_PNG_BYTES),
            )

        self.login()
        response = self.client.get(reverse("api_memoirs"))
        payload = response.json()

        self.assertEqual(len(payload["memoirs"]), 20)
        self.assertEqual(payload["pagination"]["page"], 1)
        self.assertEqual(payload["pagination"]["pageSize"], 20)
        self.assertTrue(payload["pagination"]["hasMore"])
        self.assertEqual(payload["pagination"]["nextPage"], 2)
        first = payload["memoirs"][0]
        self.assertEqual(first["title"], "Memory 24")
        self.assertEqual(first["mediaCount"], 5)
        self.assertEqual(len(first["media"]), 3)
        self.assertEqual(first["urls"]["media"], reverse("api_memoir_media", kwargs={"pk": media_owner.pk}))

        second_response = self.client.get(f"{reverse('api_memoirs')}?page=2")
        second_payload = second_response.json()
        self.assertEqual(len(second_payload["memoirs"]), 5)
        self.assertFalse(second_payload["pagination"]["hasMore"])
        self.assertIsNone(second_payload["pagination"]["nextPage"])
        self.assertFalse({item["id"] for item in payload["memoirs"]} & {item["id"] for item in second_payload["memoirs"]})

    def test_memoir_api_supports_server_side_sections_and_sort(self):
        dated = Memoir.objects.create(title="Dated", memory_date=date(2026, 1, 2), location="厦门", mood="平静", owner=self.user)
        older = Memoir.objects.create(title="Older", memory_date=date(2026, 1, 1), owner=self.user)
        Memoir.objects.create(title="Letter", story="正文", owner=self.user)
        Memoir.objects.create(title="No metadata", owner=self.user)

        self.login()
        payload = self.client.get(f"{reverse('api_memoirs')}?section=timeline&sort=asc").json()
        self.assertEqual([item["title"] for item in payload["memoirs"]], ["Older", "Dated"])
        self.assertEqual(payload["section"], "timeline")
        self.assertEqual(payload["sort"], "asc")

        payload = self.client.get(f"{reverse('api_memoirs')}?section=location").json()
        self.assertEqual([item["title"] for item in payload["memoirs"]], ["Dated"])

        payload = self.client.get(f"{reverse('api_memoirs')}?section=letter").json()
        self.assertEqual([item["title"] for item in payload["memoirs"]], ["Letter"])

    def test_media_gallery_only_includes_current_user_media(self):
        owner_memoir = Memoir.objects.create(
            title="Owner memory",
            memory_date=date(2026, 5, 1),
            location="厦门",
            mood="平静",
            owner=self.user,
        )
        other_memoir = Memoir.objects.create(title="Other memory", owner=self.other_user)
        MemoirMedia.objects.create(
            memoir=owner_memoir,
            file=SimpleUploadedFile("owner.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="owner.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        MemoirMedia.objects.create(
            memoir=other_memoir,
            file=SimpleUploadedFile("other.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="other.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )

        self.login()
        response = self.client.get(reverse("media_gallery"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '"page": "media-gallery"')
        self.assertContains(response, "owner.jpg")
        self.assertNotContains(response, "other.jpg")
        payload = app_payload(response)
        media = payload["media"][0]
        self.assertEqual(media["memoirTitle"], "Owner memory")
        self.assertEqual(media["memoryDate"], "2026-05-01")
        self.assertEqual(media["dateLabel"], "2026-05-01")
        self.assertEqual(media["location"], "厦门")
        self.assertEqual(media["mood"], "平静")
        self.assertEqual(media["memoirUrl"], reverse("memoir_detail", kwargs={"pk": owner_memoir.pk}))

    def test_media_gallery_filters_and_groups_by_memory_metadata(self):
        dated = Memoir.objects.create(
            title="厦门日落",
            memory_date=date(2026, 5, 1),
            location="厦门",
            owner=self.user,
        )
        older = Memoir.objects.create(
            title="重庆旧街",
            memory_date=date(2025, 2, 3),
            location="重庆",
            owner=self.user,
        )
        undated = Memoir.objects.create(title="没有日期", location="厦门", owner=self.user)
        deleted = Memoir.objects.create(
            title="已删除相册",
            memory_date=date(2026, 8, 9),
            location="厦门",
            owner=self.user,
        )
        deleted.soft_delete()

        MemoirMedia.objects.create(
            memoir=dated,
            file=SimpleUploadedFile("xiamen.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="xiamen.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        MemoirMedia.objects.create(
            memoir=dated,
            file=SimpleUploadedFile("xiamen.mp4", b"video bytes", content_type="video/mp4"),
            original_filename="xiamen.mp4",
            media_type=MemoirMedia.MediaType.VIDEO,
            mime_type="video/mp4",
            size=11,
        )
        MemoirMedia.objects.create(
            memoir=older,
            file=SimpleUploadedFile("chongqing.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="chongqing.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        MemoirMedia.objects.create(
            memoir=undated,
            file=SimpleUploadedFile("undated.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="undated.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        MemoirMedia.objects.create(
            memoir=deleted,
            file=SimpleUploadedFile("deleted.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="deleted.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )

        self.login()
        response = self.client.get(reverse("media_gallery"))
        payload = app_payload(response)

        self.assertEqual(payload["stats"]["media"], 4)
        self.assertEqual(payload["stats"]["photos"], 3)
        self.assertEqual(payload["stats"]["videos"], 1)
        self.assertEqual([group["label"] for group in payload["groups"]], ["2026-05-01", "2025-02-03", "未记录日期"])
        self.assertCountEqual(payload["filterOptions"]["years"], ["2026", "2025"])
        self.assertCountEqual(payload["filterOptions"]["locations"], ["厦门", "重庆"])
        self.assertNotContains(response, "deleted.jpg")

        payload = app_payload(self.client.get(f"{reverse('media_gallery')}?type=image"))
        self.assertEqual(payload["filters"]["type"], "image")
        self.assertEqual(payload["stats"]["media"], 3)
        self.assertTrue(all(item["type"] == "image" for item in payload["media"]))

        payload = app_payload(self.client.get(f"{reverse('media_gallery')}?type=video"))
        self.assertEqual(payload["stats"]["media"], 1)
        self.assertEqual(payload["media"][0]["name"], "xiamen.mp4")

        payload = app_payload(self.client.get(f"{reverse('media_gallery')}?year=2026"))
        self.assertEqual(payload["filters"]["year"], "2026")
        self.assertCountEqual([item["name"] for item in payload["media"]], ["xiamen.jpg", "xiamen.mp4"])

        payload = app_payload(self.client.get(f"{reverse('media_gallery')}?location=%E5%8E%A6%E9%97%A8"))
        self.assertEqual(payload["filters"]["location"], "厦门")
        self.assertCountEqual([item["name"] for item in payload["media"]], ["xiamen.jpg", "xiamen.mp4", "undated.jpg"])

    def test_media_gallery_api_paginates_filtered_media(self):
        memoir = Memoir.objects.create(
            title="Paged gallery",
            memory_date=date(2026, 5, 1),
            location="厦门",
            owner=self.user,
        )
        deleted = Memoir.objects.create(title="Deleted gallery", location="厦门", owner=self.user)
        deleted.soft_delete()
        for index in range(65):
            MemoirMedia.objects.create(
                memoir=memoir,
                file=SimpleUploadedFile(f"gallery-{index}.jpg", TINY_PNG_BYTES, content_type="image/png"),
                original_filename=f"gallery-{index}.jpg",
                media_type=MemoirMedia.MediaType.IMAGE,
                mime_type="image/png",
                size=len(TINY_PNG_BYTES),
            )
        MemoirMedia.objects.create(
            memoir=deleted,
            file=SimpleUploadedFile("deleted-gallery.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="deleted-gallery.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )

        self.login()
        payload = self.client.get(f"{reverse('api_media_gallery')}?type=image&location=%E5%8E%A6%E9%97%A8").json()

        self.assertEqual(len(payload["media"]), 60)
        self.assertEqual(payload["stats"]["media"], 65)
        self.assertTrue(payload["pagination"]["hasMore"])
        self.assertEqual(payload["pagination"]["nextPage"], 2)
        self.assertEqual(payload["filters"]["type"], "image")
        self.assertEqual(payload["filters"]["location"], "厦门")
        self.assertNotIn("deleted-gallery.jpg", [item["name"] for item in payload["media"]])

        second_payload = self.client.get(f"{reverse('api_media_gallery')}?type=image&location=%E5%8E%A6%E9%97%A8&page=2").json()
        self.assertEqual(len(second_payload["media"]), 5)
        self.assertFalse(second_payload["pagination"]["hasMore"])

    def test_backup_page_shows_active_export_scope(self):
        active = Memoir.objects.create(title="Active export", owner=self.user)
        deleted = Memoir.objects.create(title="Deleted export", owner=self.user)
        deleted.soft_delete()
        MemoirMedia.objects.create(
            memoir=active,
            file=SimpleUploadedFile("active.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="active.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        MemoirMedia.objects.create(
            memoir=deleted,
            file=SimpleUploadedFile("deleted.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="deleted.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )

        self.login()
        response = self.client.get(reverse("backup"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '"page": "backup"')
        payload = app_payload(response)
        self.assertEqual(payload["exportUrl"], reverse("memoir_export"))
        self.assertEqual(payload["stats"]["memoirs"], 1)
        self.assertEqual(payload["stats"]["media"], 1)
        self.assertEqual(payload["stats"]["photos"], 1)
        self.assertEqual(payload["stats"]["videos"], 0)

    def test_export_zip_contains_only_active_current_user_memoirs(self):
        active = Memoir.objects.create(
            title="Export Day",
            story="A readable story for the backup.",
            memory_date=date(2026, 5, 6),
            location="Xiamen",
            mood="Calm",
            owner=self.user,
        )
        deleted = Memoir.objects.create(title="Trash Memory", owner=self.user)
        deleted.soft_delete()
        other = Memoir.objects.create(title="Other Memory", owner=self.other_user)
        active_media = MemoirMedia.objects.create(
            memoir=active,
            file=SimpleUploadedFile("summer photo.png", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="summer photo.png",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        MemoirMedia.objects.create(
            memoir=deleted,
            file=SimpleUploadedFile("trash.jpg", b"trash bytes", content_type="image/jpeg"),
            original_filename="trash.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/jpeg",
            size=11,
        )
        MemoirMedia.objects.create(
            memoir=other,
            file=SimpleUploadedFile("other.jpg", b"other bytes", content_type="image/jpeg"),
            original_filename="other.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/jpeg",
            size=11,
        )

        self.login()
        response = self.client.get(reverse("memoir_export"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/zip")
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertIn("memoirs-backup-", response["Content-Disposition"])
        self.assertIn(".zip", response["Content-Disposition"])

        with zipfile.ZipFile(BytesIO(response.content), "r") as archive:
            names = archive.namelist()
            self.assertIn("manifest.json", names)
            self.assertIn("memoirs.json", names)
            markdown_paths = [name for name in names if name.startswith("markdown/") and name.endswith(".md")]
            media_paths = [name for name in names if name.startswith(f"media/{active.pk}/")]
            self.assertEqual(len(markdown_paths), 1)
            self.assertEqual(len(media_paths), 1)
            self.assertEqual(archive.read(media_paths[0]), TINY_PNG_BYTES)

            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            self.assertEqual(manifest["formatVersion"], 1)
            self.assertEqual(manifest["app"], "Memoirs")
            self.assertEqual(manifest["username"], self.user.username)
            self.assertFalse(manifest["includeDeleted"])
            self.assertEqual(manifest["memoirCount"], 1)
            self.assertEqual(manifest["mediaCount"], 1)

            memoirs_payload = json.loads(archive.read("memoirs.json").decode("utf-8"))
            self.assertEqual(len(memoirs_payload["memoirs"]), 1)
            exported = memoirs_payload["memoirs"][0]
            self.assertEqual(exported["id"], str(active.pk))
            self.assertEqual(exported["title"], "Export Day")
            self.assertEqual(exported["story"], "A readable story for the backup.")
            self.assertEqual(exported["memoryDate"], "2026-05-06")
            self.assertEqual(exported["location"], "Xiamen")
            self.assertEqual(exported["mood"], "Calm")
            self.assertEqual(exported["markdownPath"], markdown_paths[0])
            self.assertEqual(exported["media"][0]["id"], active_media.id)
            self.assertEqual(exported["media"][0]["archivePath"], media_paths[0])

            markdown = archive.read(markdown_paths[0]).decode("utf-8")
            self.assertIn("# Export Day", markdown)
            self.assertIn("2026-05-06", markdown)
            self.assertIn("Xiamen", markdown)
            self.assertIn("Calm", markdown)
            self.assertIn("A readable story for the backup.", markdown)
            self.assertIn(f"../{media_paths[0]}", markdown)

            archive_text = "\n".join(names) + "\n" + json.dumps(memoirs_payload)
            self.assertNotIn("Trash Memory", archive_text)
            self.assertNotIn("Other Memory", archive_text)
            self.assertFalse(any(name.startswith(f"media/{deleted.pk}/") for name in names))
            self.assertFalse(any(name.startswith(f"media/{other.pk}/") for name in names))

    def test_list_preloads_first_image_thumbnail(self):
        self.login()
        memoir = Memoir.objects.create(title="有媒体", owner=self.user)
        image = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("ready.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="ready.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        video = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("ready.mp4", b"fake video bytes", content_type="video/mp4"),
            original_filename="ready.mp4",
            media_type=MemoirMedia.MediaType.VIDEO,
            mime_type="video/mp4",
            size=16,
        )

        response = self.client.get(reverse("memoir_list"))
        thumbnail_url = reverse("protected_media_thumbnail", kwargs={"media_id": image.id})

        self.assertContains(response, f'<link rel="preload" as="image" href="{thumbnail_url}" fetchpriority="high">')
        self.assertContains(response, '"page": "archive"')
        self.assertContains(response, "ready.jpg")
        self.assertContains(response, "ready.mp4")
        self.assertNotContains(response, f'<link rel="preload" as="image" href="{video.protected_url}"')

    def test_detail_media_is_paginated_and_owner_only(self):
        memoir = Memoir.objects.create(title="Detail media", owner=self.user)
        for index in range(65):
            MemoirMedia.objects.create(
                memoir=memoir,
                file=SimpleUploadedFile(f"detail-{index}.jpg", TINY_PNG_BYTES, content_type="image/png"),
                original_filename=f"detail-{index}.jpg",
                media_type=MemoirMedia.MediaType.IMAGE,
                mime_type="image/png",
                size=len(TINY_PNG_BYTES),
            )

        self.login()
        response = self.client.get(reverse("memoir_detail", kwargs={"pk": memoir.pk}))
        payload = app_payload(response)

        self.assertEqual(len(payload["memoir"]["media"]), 60)
        self.assertEqual(payload["memoir"]["mediaCount"], 65)
        self.assertTrue(payload["mediaPagination"]["hasMore"])
        self.assertEqual(payload["mediaPagination"]["nextPage"], 2)

        api_response = self.client.get(f"{reverse('api_memoir_media', kwargs={'pk': memoir.pk})}?page=2")
        api_payload = api_response.json()
        self.assertEqual(len(api_payload["media"]), 5)
        self.assertEqual(api_payload["mediaCount"], 65)
        self.assertFalse(api_payload["pagination"]["hasMore"])

        self.client.logout()
        self.client.login(username="other", password="secret12345")
        response = self.client.get(reverse("api_memoir_media", kwargs={"pk": memoir.pk}))
        self.assertEqual(response.status_code, 404)

        self.client.logout()
        self.login()
        memoir.soft_delete()
        response = self.client.get(reverse("api_memoir_media", kwargs={"pk": memoir.pk}))
        self.assertEqual(response.status_code, 404)

    def test_update_memoir_changes_fields_and_removes_media(self):
        self.login()
        memoir = Memoir.objects.create(title="旧标题", story="旧正文", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("old.jpg", b"old image bytes", content_type="image/jpeg"),
            original_filename="old.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/jpeg",
            size=15,
        )
        media_path = Path(media.file.path)

        response = self.client.post(
            reverse("memoir_update", kwargs={"pk": memoir.pk}),
            {
                "title": "新标题",
                "story": "新正文",
                "memory_date": "2026-04-03",
                "location": "新地点",
                "mood": "新心情",
                "delete_media": [str(media.id)],
                "media": [SimpleUploadedFile("new.jpg", b"new image bytes", content_type="image/jpeg")],
            },
        )

        self.assertEqual(response.status_code, 302)
        memoir.refresh_from_db()
        self.assertEqual(memoir.title, "新标题")
        self.assertEqual(memoir.story, "新正文")
        self.assertEqual(memoir.location, "新地点")
        self.assertFalse(media_path.exists())
        self.assertEqual(memoir.media_items.count(), 1)
        self.assertEqual(memoir.media_items.get().original_filename, "new.jpg")

    def test_delete_memoir_moves_to_trash_and_keeps_media_file(self):
        self.login()
        memoir = Memoir.objects.create(title="要删除", mood="怀念", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("photo.jpg", b"fake image bytes", content_type="image/jpeg"),
            original_filename="photo.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/jpeg",
            size=16,
        )
        media_path = Path(media.file.path)
        self.assertTrue(media_path.exists())

        response = self.client.post(reverse("memoir_delete", kwargs={"pk": memoir.pk}))

        self.assertEqual(response.status_code, 302)
        memoir.refresh_from_db()
        self.assertIsNotNone(memoir.deleted_at)
        self.assertTrue(Memoir.objects.filter(pk=memoir.pk).exists())
        self.assertTrue(media_path.exists())

        response = self.client.get(reverse("api_memoirs"))
        payload = response.json()
        self.assertEqual(payload["memoirs"], [])
        self.assertEqual(payload["stats"]["memoirs"], 0)
        self.assertEqual(payload["stats"]["deletedMemoirs"], 1)
        self.assertEqual(payload["stats"]["media"], 0)

        response = self.client.get(f"{reverse('api_memoirs')}?deleted=1")
        payload = response.json()
        self.assertEqual(len(payload["memoirs"]), 1)
        self.assertTrue(payload["memoirs"][0]["isDeleted"])
        self.assertEqual(payload["memoirs"][0]["title"], "要删除")

        response = self.client.get(reverse("media_gallery"))
        self.assertNotContains(response, "photo.jpg")

        response = self.client.get(reverse("memoir_detail", kwargs={"pk": memoir.pk}))
        self.assertEqual(response.status_code, 404)
        response = self.client.get(reverse("memoir_update", kwargs={"pk": memoir.pk}))
        self.assertEqual(response.status_code, 404)

    def test_api_delete_returns_fresh_stats(self):
        self.login()
        memoir = Memoir.objects.create(title="API delete", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("api-delete.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="api-delete.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        media_path = Path(media.file.path)

        response = self.client.post(reverse("api_memoir_delete", kwargs={"pk": memoir.pk}))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stats"]["memoirs"], 0)
        self.assertEqual(response.json()["stats"]["deletedMemoirs"], 1)
        self.assertEqual(response.json()["stats"]["media"], 0)
        self.assertTrue(media_path.exists())

    def test_restore_deleted_memoir_returns_it_to_active_views(self):
        self.login()
        memoir = Memoir.objects.create(title="可恢复", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("restore.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="restore.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        memoir.soft_delete()

        response = self.client.post(reverse("api_memoir_restore", kwargs={"pk": memoir.pk}))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stats"]["memoirs"], 1)
        self.assertEqual(response.json()["stats"]["deletedMemoirs"], 0)
        self.assertEqual(response.json()["stats"]["media"], 1)
        memoir.refresh_from_db()
        self.assertIsNone(memoir.deleted_at)
        self.assertFalse(response.json()["memoir"]["isDeleted"])

        response = self.client.get(reverse("api_memoirs"))
        payload = response.json()
        self.assertEqual([item["title"] for item in payload["memoirs"]], ["可恢复"])
        self.assertEqual(payload["stats"]["memoirs"], 1)
        self.assertEqual(payload["stats"]["deletedMemoirs"], 0)
        self.assertEqual(payload["stats"]["media"], 1)

        response = self.client.get(reverse("media_gallery"))
        self.assertContains(response, media.original_filename)
        response = self.client.get(reverse("memoir_detail", kwargs={"pk": memoir.pk}))
        self.assertEqual(response.status_code, 200)
        response = self.client.get(reverse("memoir_update", kwargs={"pk": memoir.pk}))
        self.assertEqual(response.status_code, 200)

    def test_destroy_deleted_memoir_removes_database_rows_and_media_file(self):
        self.login()
        memoir = Memoir.objects.create(title="永久删除", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("destroy.jpg", b"destroy image bytes", content_type="image/jpeg"),
            original_filename="destroy.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/jpeg",
            size=19,
        )
        media_path = Path(media.file.path)
        memoir.soft_delete()

        response = self.client.post(reverse("api_memoir_destroy", kwargs={"pk": memoir.pk}))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stats"]["memoirs"], 0)
        self.assertEqual(response.json()["stats"]["deletedMemoirs"], 0)
        self.assertEqual(response.json()["stats"]["media"], 0)
        self.assertFalse(Memoir.objects.filter(pk=memoir.pk).exists())
        self.assertFalse(MemoirMedia.objects.filter(pk=media.pk).exists())
        self.assertFalse(media_path.exists())

    def test_other_user_cannot_restore_or_destroy_deleted_memoir(self):
        memoir = Memoir.objects.create(title="别人不能处理", owner=self.user)
        memoir.soft_delete()

        self.client.login(username="other", password="secret12345")
        response = self.client.post(reverse("api_memoir_restore", kwargs={"pk": memoir.pk}))
        self.assertEqual(response.status_code, 404)
        response = self.client.post(reverse("api_memoir_destroy", kwargs={"pk": memoir.pk}))
        self.assertEqual(response.status_code, 404)

        memoir.refresh_from_db()
        self.assertIsNotNone(memoir.deleted_at)

    def test_deleted_memoir_cannot_receive_edit_mobile_uploads(self):
        self.login()
        memoir = Memoir.objects.create(title="已进回收站", owner=self.user)
        self.client.get(reverse("memoir_update", kwargs={"pk": memoir.pk}))
        session = MobileUploadSession.objects.get(
            owner=self.user,
            mode=MobileUploadSession.Mode.EDIT,
            memoir=memoir,
        )
        memoir.soft_delete()

        response = self.client.get(reverse("mobile_upload", kwargs={"token": session.token}))
        self.assertEqual(response.status_code, 404)
        response = self.client.post(
            reverse("mobile_upload", kwargs={"token": session.token}),
            {"media": [SimpleUploadedFile("late.jpg", b"late image bytes", content_type="image/jpeg")]},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(memoir.media_items.count(), 0)

        response = self.client.post(
            reverse("api_mobile_upload_sessions"),
            data=json.dumps({"mode": "edit", "memoirId": str(memoir.pk)}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

    def test_protected_media_is_owner_or_staff_only(self):
        memoir = Memoir.objects.create(title="私密", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("photo.jpg", b"fake image bytes", content_type="image/jpeg"),
            original_filename="photo.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/jpeg",
            size=16,
        )

        response = self.client.get(media.protected_url)
        self.assertEqual(response.status_code, 302)

        self.client.login(username="other", password="secret12345")
        response = self.client.get(media.protected_url)
        self.assertEqual(response.status_code, 404)

        self.client.logout()
        self.login()
        response = self.client.get(media.protected_url)
        self.assertEqual(response.status_code, 200)
        response.close()

    def test_protected_media_download_uses_original_filename(self):
        memoir = Memoir.objects.create(title="下载", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("stored.jpg", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="original-photo.jpg",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )

        self.login()
        response = self.client.get(f"{media.protected_url}?download=1")

        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertIn("original-photo.jpg", response["Content-Disposition"])
        response.close()

    def test_protected_media_supports_byte_ranges(self):
        memoir = Memoir.objects.create(title="视频", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("clip.mp4", b"0123456789", content_type="video/mp4"),
            original_filename="clip.mp4",
            media_type=MemoirMedia.MediaType.VIDEO,
            mime_type="video/mp4",
            size=10,
        )

        self.login()
        response = self.client.get(media.protected_url, HTTP_RANGE="bytes=2-5")

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response["Accept-Ranges"], "bytes")
        self.assertEqual(response["Content-Range"], "bytes 2-5/10")
        self.assertEqual(b"".join(response.streaming_content), b"2345")
        response.close()

    def test_protected_media_rejects_invalid_byte_ranges(self):
        memoir = Memoir.objects.create(title="视频", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("clip.mp4", b"0123456789", content_type="video/mp4"),
            original_filename="clip.mp4",
            media_type=MemoirMedia.MediaType.VIDEO,
            mime_type="video/mp4",
            size=10,
        )

        self.login()
        response = self.client.get(media.protected_url, HTTP_RANGE="bytes=20-30")

        self.assertEqual(response.status_code, 416)
        self.assertEqual(response["Content-Range"], "bytes */10")

    def test_protected_thumbnail_is_owner_only(self):
        memoir = Memoir.objects.create(title="缩略图", owner=self.user)
        media = MemoirMedia.objects.create(
            memoir=memoir,
            file=SimpleUploadedFile("photo.png", TINY_PNG_BYTES, content_type="image/png"),
            original_filename="photo.png",
            media_type=MemoirMedia.MediaType.IMAGE,
            mime_type="image/png",
            size=len(TINY_PNG_BYTES),
        )
        thumbnail_url = reverse("protected_media_thumbnail", kwargs={"media_id": media.id})

        self.client.login(username="other", password="secret12345")
        response = self.client.get(thumbnail_url)
        self.assertEqual(response.status_code, 404)

        self.client.logout()
        self.login()
        response = self.client.get(thumbnail_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/webp")
        response.close()
