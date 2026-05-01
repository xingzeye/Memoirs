from django.urls import path

from . import views


urlpatterns = [
    path("", views.memoir_list, name="memoir_list"),
    path("memoirs/", views.memoir_list, name="memoir_list_alt"),
    path("memoirs/new/", views.memoir_create, name="memoir_create"),
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
]
