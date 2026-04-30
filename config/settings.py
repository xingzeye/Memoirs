from __future__ import annotations

import os
from importlib.util import find_spec
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent


def load_local_env() -> None:
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    value = os.environ.get(name, default)
    return [item.strip() for item in value.split(",") if item.strip()]


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return int(value.strip())
    except ValueError as exc:
        raise ImproperlyConfigured(f"{name} must be an integer.") from exc


def append_unique(items: list[str], value: str) -> None:
    if value and value not in items:
        items.append(value)


load_local_env()

DEBUG = env_bool("DEBUG", True)
SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-local-memoirs-change-before-public-deploy"
    else:
        raise ImproperlyConfigured("SECRET_KEY must be set when DEBUG=False.")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "127.0.0.1,localhost")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
ALLOW_PUBLIC_REGISTRATION = env_bool("ALLOW_PUBLIC_REGISTRATION", DEBUG)

render_external_hostname = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "").strip()
if render_external_hostname:
    append_unique(ALLOWED_HOSTS, render_external_hostname)
    append_unique(CSRF_TRUSTED_ORIGINS, f"https://{render_external_hostname}")

INSTALLED_APPS = [
    "simpleui",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "memories",
]

WHITENOISE_INSTALLED = find_spec("whitenoise") is not None
if not DEBUG and not WHITENOISE_INSTALLED:
    raise ImproperlyConfigured("whitenoise must be installed when DEBUG=False.")

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
if WHITENOISE_INSTALLED:
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "config.context_processors.public_registration",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

database_url = os.environ.get("DATABASE_URL")
if database_url:
    import dj_database_url

    DATABASES = {
        "default": dj_database_url.parse(
            database_url,
            conn_max_age=600,
            conn_health_checks=True,
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": (
            "whitenoise.storage.CompressedManifestStaticFilesStorage"
            if WHITENOISE_INSTALLED
            else "django.contrib.staticfiles.storage.StaticFilesStorage"
        ),
    },
}

R2_REQUIRED_SETTINGS = {
    "R2_BUCKET_NAME": os.environ.get("R2_BUCKET_NAME", "").strip(),
    "R2_ENDPOINT_URL": os.environ.get("R2_ENDPOINT_URL", "").strip(),
    "R2_ACCESS_KEY_ID": os.environ.get("R2_ACCESS_KEY_ID", "").strip(),
    "R2_SECRET_ACCESS_KEY": os.environ.get("R2_SECRET_ACCESS_KEY", "").strip(),
}
USE_R2_STORAGE = any(R2_REQUIRED_SETTINGS.values()) or not DEBUG
if USE_R2_STORAGE:
    if find_spec("storages") is None:
        raise ImproperlyConfigured("django-storages must be installed when R2 media storage is enabled.")

    missing_r2_settings = [key for key, value in R2_REQUIRED_SETTINGS.items() if not value]
    if missing_r2_settings:
        missing = ", ".join(missing_r2_settings)
        raise ImproperlyConfigured(f"R2 media storage is enabled but missing: {missing}.")

    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
    }
    AWS_STORAGE_BUCKET_NAME = R2_REQUIRED_SETTINGS["R2_BUCKET_NAME"]
    AWS_S3_ENDPOINT_URL = R2_REQUIRED_SETTINGS["R2_ENDPOINT_URL"]
    AWS_ACCESS_KEY_ID = R2_REQUIRED_SETTINGS["R2_ACCESS_KEY_ID"]
    AWS_SECRET_ACCESS_KEY = R2_REQUIRED_SETTINGS["R2_SECRET_ACCESS_KEY"]
    AWS_S3_REGION_NAME = os.environ.get("R2_REGION", "auto")
    AWS_S3_SIGNATURE_VERSION = "s3v4"
    AWS_S3_ADDRESSING_STYLE = "path"
    AWS_DEFAULT_ACL = None
    AWS_QUERYSTRING_AUTH = True
    AWS_QUERYSTRING_EXPIRE = env_int("R2_QUERYSTRING_EXPIRE", 3600)
    AWS_S3_FILE_OVERWRITE = False

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "memoir_list"
LOGOUT_REDIRECT_URL = "login"

FILE_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024 * 1024

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", not DEBUG)
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", not DEBUG)
SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 0 if DEBUG else 31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", False)

SIMPLEUI_HOME_INFO = False
SIMPLEUI_ANALYSIS = False
SIMPLEUI_STATIC_OFFLINE = True
SIMPLEUI_LOGO = False
SIMPLEUI_CONFIG = {
    "system_keep": False,
    "menu_display": ["回忆管理", "认证和授权"],
    "dynamic": False,
    "menus": [
        {
            "app": "memories",
            "name": "回忆管理",
            "icon": "fas fa-book-open",
            "models": [
                {"name": "回忆", "icon": "fas fa-book", "url": "memories/memoir/"},
                {"name": "媒体文件", "icon": "fas fa-photo-video", "url": "memories/memoirmedia/"},
            ],
        },
        {
            "app": "auth",
            "name": "认证和授权",
            "icon": "fas fa-users-cog",
            "models": [
                {"name": "用户", "icon": "fas fa-user", "url": "auth/user/"},
                {"name": "用户组", "icon": "fas fa-users", "url": "auth/group/"},
            ],
        },
    ],
}
