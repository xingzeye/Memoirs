from django.urls import path

from . import views


urlpatterns = [
    path("", views.memoir_list, name="memoir_list"),
    path("memoirs/", views.memoir_list, name="memoir_list_alt"),
    path("memoirs/media/", views.media_gallery, name="media_gallery"),
    path("memoirs/new/", views.memoir_create, name="memoir_create"),
    path("memoirs/<uuid:pk>/", views.memoir_detail, name="memoir_detail"),
    path("memoirs/<uuid:pk>/edit/", views.memoir_update, name="memoir_update"),
    path("memoirs/<uuid:pk>/delete/", views.memoir_delete, name="memoir_delete"),
    path("mobile-upload/<str:token>/", views.mobile_upload, name="mobile_upload"),
    path("mobile-upload/<str:token>/status/", views.mobile_upload_status, name="mobile_upload_status"),
    path(
        "mobile-upload/<str:token>/items/<int:item_id>/preview/",
        views.mobile_upload_item_preview,
        name="mobile_upload_item_preview",
    ),
    path("protected-media/<path:file_path>", views.protected_media, name="protected_media"),
    path("protected-media-thumbnails/<int:media_id>/", views.protected_media_thumbnail, name="protected_media_thumbnail"),
    path("api/session/", views.api_session, name="api_session"),
    path("api/auth/login/", views.api_login, name="api_login"),
    path("api/auth/register/", views.api_register, name="api_register"),
    path("api/auth/logout/", views.api_logout, name="api_logout"),
    path("api/memoirs/", views.api_memoirs, name="api_memoirs"),
    path("api/memoirs/<uuid:pk>/", views.api_memoir_detail, name="api_memoir_detail"),
    path("api/memoirs/<uuid:pk>/delete/", views.api_memoir_delete, name="api_memoir_delete"),
    path("api/mobile-upload-sessions/", views.api_mobile_upload_sessions, name="api_mobile_upload_sessions"),
]
