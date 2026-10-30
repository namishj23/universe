"""
PlatformIdentity: the only way into the service (contract §3).

Every request must come from loopback, carry the shared X-Service-Token and name the
signed-in platform user in the X-UniVerse-* headers, with role invigilator or admin.
There is no login, session, cookie or CORS here: the platform has already done all that.
"""

import hashlib
import hmac
import ipaddress
import re
import uuid
from urllib.parse import unquote

from django.conf import settings

from .errors import error_response

REVIEWER_ROLES = {"invigilator", "admin"}
REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")


def _digest(value):
    key = settings.SECRET_KEY.encode()
    return hmac.new(key, value.encode(), hashlib.sha256).digest()


def token_matches(sent):
    """Compare HMAC-SHA256 digests, so neither the value nor its length leaks through timing."""
    return sent is not None and hmac.compare_digest(_digest(sent), _digest(settings.SERVICE_TOKEN_EXAM))


def is_loopback(address):
    try:
        ip = ipaddress.ip_address(address or "")
    except ValueError:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)
    return (mapped or ip).is_loopback


class Identity:
    __slots__ = ("id", "role", "name")

    def __init__(self, user_id, role, name):
        self.id, self.role, self.name = user_id, role, name


class PlatformIdentity:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        sent_id = request.headers.get("X-Request-Id", "")
        request.request_id = sent_id if REQUEST_ID.match(sent_id) else str(uuid.uuid4())
        response = self._check(request) or self.get_response(request)
        response["X-Request-Id"] = request.request_id
        return response

    def _check(self, request):
        # REMOTE_ADDR is the socket's address (waitress trusts no proxy headers).
        if not is_loopback(request.META.get("REMOTE_ADDR")):
            return error_response(request, 403, "FORBIDDEN", "The exam service only accepts local requests.")
        if not token_matches(request.headers.get("X-Service-Token")):
            return error_response(request, 401, "UNAUTHENTICATED", "A valid service token is required.")
        user_id = request.headers.get("X-UniVerse-User-Id", "")
        role = request.headers.get("X-UniVerse-User-Role", "")
        try:
            user_id = uuid.UUID(user_id)
        except ValueError:
            return error_response(request, 401, "UNAUTHENTICATED", "The signed-in user is missing.")
        if not role:
            return error_response(request, 401, "UNAUTHENTICATED", "The signed-in user is missing.")
        if role not in REVIEWER_ROLES:
            return error_response(request, 403, "FORBIDDEN", "Only invigilators and admins can use exam review.")
        name = unquote(request.headers.get("X-UniVerse-User-Name", "")).strip()[:200]
        request.identity = Identity(user_id, role, name)
        return None
