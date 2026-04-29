from django.urls import path

from . import views


urlpatterns = [
    path("", views.memoir_list, name="memoir_list"),
    path("memoirs/", views.memoir_list, name="memoir_list_alt"),
    path("memoirs/new/", views.memoir_create, name="memoir_create"),
    path("memoirs/<uuid:pk>/edit/", views.memoir_update, name="memoir_update"),
    path("memoirs/<uuid:pk>/delete/", views.memoir_delete, name="memoir_delete"),
    path("protected-media/<path:file_path>", views.protected_media, name="protected_media"),
]
