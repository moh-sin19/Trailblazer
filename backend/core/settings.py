import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev")
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "*").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
    "rest_framework",
    "corsheaders",
    "allauth",
    "allauth.account",
    "accounts",
    "trails",
]

try:  # Enable GeoDjango only when available (e.g., production environments)
    from trails.gis_compat import GIS_AVAILABLE

    if GIS_AVAILABLE:
        INSTALLED_APPS.insert(6, "django.contrib.gis")
except Exception:  # pragma: no cover - defensive safety
    pass

SITE_ID = 1

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "core.wsgi.application"

if os.getenv("POSTGRES_DB"):
    DATABASES = {
        "default": {
            "ENGINE": "django.contrib.gis.db.backends.postgis",
            "NAME": os.getenv("POSTGRES_DB"),
            "USER": os.getenv("POSTGRES_USER"),
            "PASSWORD": os.getenv("POSTGRES_PASSWORD"),
            "HOST": os.getenv("POSTGRES_HOST"),
            "PORT": os.getenv("POSTGRES_PORT"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

CORS_ALLOWED_ORIGINS = [
    os.getenv("DJANGO_CORS_ORIGIN", "http://localhost:4200"),
    "http://127.0.0.1:4200",
]
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = ["http://localhost:4200", "http://127.0.0.1:4200"]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

# allauth basic settings
ACCOUNT_AUTHENTICATION_METHOD = "username_email"
ACCOUNT_EMAIL_REQUIRED = True
ACCOUNT_EMAIL_VERIFICATION = "none"
LOGIN_REDIRECT_URL = "/"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.AllowAny",),
}

SESSION_COOKIE_AGE = 60 * 60 * 24 * 7  # 7 days
SESSION_SAVE_EVERY_REQUEST = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = os.getenv("DJANGO_SESSION_SECURE", "0") == "1"
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"
EMAIL_VERIFICATION_TOKEN_HOURS = 24

EMAIL_BACKEND = os.getenv(
    "DJANGO_EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend",
)

DEFAULT_FROM_EMAIL = os.getenv(
    "DJANGO_DEFAULT_FROM_EMAIL", "no-reply@trailblazer.local"
)

if os.getenv("DJANGO_EMAIL_HOST") is not None:
    EMAIL_HOST = os.environ["DJANGO_EMAIL_HOST"]
if os.getenv("DJANGO_EMAIL_PORT") is not None:
    EMAIL_PORT = os.environ["DJANGO_EMAIL_PORT"]
if os.getenv("DJANGO_EMAIL_USE_TLS") is not None:
    EMAIL_USE_TLS = os.environ["DJANGO_EMAIL_USE_TLS"]
if os.getenv("DJANGO_EMAIL_HOST_USER") is not None:
    EMAIL_HOST_USER = os.environ["DJANGO_EMAIL_HOST_USER"]
if os.getenv("DJANGO_EMAIL_HOST_PASSWORD") is not None:
    EMAIL_HOST_PASSWORD = os.environ["DJANGO_EMAIL_HOST_PASSWORD"]

FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:4200")
EMAIL_VERIFICATION_SUBJECT = os.getenv(
    "EMAIL_VERIFICATION_SUBJECT",
    "Verify your Trailblazer account",
)

GRAPHHOPPER_BASE_URL = os.getenv(
    "GRAPHHOPPER_BASE_URL", "https://graphhopper.com/api/1"
)
GRAPHHOPPER_API_KEY = os.getenv("GRAPHHOPPER_API_KEY", "")
GRAPHHOPPER_PROFILE = os.getenv("GRAPHHOPPER_PROFILE", "foot")
GRAPHHOPPER_TIMEOUT = float(os.getenv("GRAPHHOPPER_TIMEOUT", "10"))
GRAPHHOPPER_CACHE_SECONDS = int(os.getenv("GRAPHHOPPER_CACHE_SECONDS", "300"))

TWO_FACTOR_EMAIL_SUBJECT = os.getenv(
    "TWO_FACTOR_EMAIL_SUBJECT",
    "Your Trailblazer security code",
)
