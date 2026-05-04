from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path

from memories.views import login_page, register


admin.site.site_header = "忆往昔"
admin.site.site_title = "忆往昔后台"
admin.site.index_title = "后台管理"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/login/", login_page, name="login"),
    path("accounts/register/", register, name="register"),
    path("accounts/logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("", include("memories.urls")),
]
