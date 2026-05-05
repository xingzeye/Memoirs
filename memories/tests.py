from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Memoir, MemoirMedia, MobileUploadItem, MobileUploadSession


TEST_MEDIA_ROOT = Path(__file__).resolve().parents[1] / ".test-media"


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class MemoirViewTests(TestCase):
    def setUp(self):
        TEST_MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
        self.user = get_user_model().objects.create_user(username="owner", password="secret12345")
        self.other_user = get_user_model().objects.create_user(username="other", password="secret12345")

    def login(self):
        self.client.login(username="owner", password="secret12345")

    def test_core_pages_require_login(self):
        for url in [reverse("memoir_list"), reverse("memoir_create")]:
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

    def test_delete_memoir_removes_media_file(self):
        self.login()
        memoir = Memoir.objects.create(title="要删除", owner=self.user)
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
        self.assertFalse(Memoir.objects.filter(pk=memoir.pk).exists())
        self.assertFalse(media_path.exists())

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
