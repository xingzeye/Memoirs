from django.conf import settings


def public_registration(request):
    return {"allow_public_registration": settings.ALLOW_PUBLIC_REGISTRATION}
