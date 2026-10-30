"""One error shape for every failure: {"error": {"code", "message", "requestId"}} (contract §3)."""

import logging

from django.core.exceptions import PermissionDenied
from django.http import Http404, JsonResponse
from rest_framework import exceptions, status

logger = logging.getLogger("exam.errors")


class ApiError(exceptions.APIException):
    def __init__(self, status_code, code, message):
        super().__init__(message)
        self.status_code, self.code, self.message = status_code, code, message


def not_found(what="flag"):
    return ApiError(404, "NOT_FOUND", f"That {what} does not exist.")


def error_body(request, code, message):
    return {"error": {"code": code, "message": message, "requestId": getattr(request, "request_id", "")}}


def error_response(request, status_code, code, message):
    return JsonResponse(error_body(request, code, message), status=status_code)


def _validation_message(detail):
    """First problem as a plain sentence, e.g. "note: This field is required."."""
    if isinstance(detail, dict):
        for field, value in detail.items():
            inner = _validation_message(value)
            return inner if field == "non_field_errors" else f"{field}: {inner}"
    if isinstance(detail, list) and detail:
        return _validation_message(detail[0])
    return str(detail)


_CODES = {
    status.HTTP_400_BAD_REQUEST: "VALIDATION_ERROR",
    status.HTTP_401_UNAUTHORIZED: "UNAUTHENTICATED",
    status.HTTP_403_FORBIDDEN: "FORBIDDEN",
    status.HTTP_404_NOT_FOUND: "NOT_FOUND",
    status.HTTP_405_METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
    status.HTTP_406_NOT_ACCEPTABLE: "NOT_ACCEPTABLE",
    status.HTTP_409_CONFLICT: "CONFLICT",
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: "FILE_TOO_LARGE",
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_TYPE",
}


def exception_handler(exc, context):
    """DRF's handler for every view: known errors keep their status, anything else is a 500."""
    request = context.get("request")
    if isinstance(exc, ApiError):
        return JsonResponse(error_body(request, exc.code, exc.message), status=exc.status_code)
    if isinstance(exc, Http404):
        return JsonResponse(error_body(request, "NOT_FOUND", "Not found."), status=404)
    if isinstance(exc, PermissionDenied):
        return JsonResponse(error_body(request, "FORBIDDEN", "Not allowed."), status=403)
    if isinstance(exc, exceptions.ValidationError):
        return JsonResponse(error_body(request, "VALIDATION_ERROR", _validation_message(exc.detail)), status=400)
    if isinstance(exc, exceptions.ParseError):
        return JsonResponse(error_body(request, "VALIDATION_ERROR", "The request body is not valid."), status=400)
    if isinstance(exc, exceptions.APIException):
        code = _CODES.get(exc.status_code, "ERROR")
        return JsonResponse(error_body(request, code, _validation_message(exc.detail)), status=exc.status_code)
    # Unexpected: the stack trace goes to the log only, with the request id to find it.
    logger.error("unhandled error", exc_info=exc, extra={"requestId": getattr(request, "request_id", "")})
    return JsonResponse(error_body(request, "INTERNAL", "Something went wrong."), status=500)


# Django's own handlers, for URLs no view matches and errors outside DRF views.
def handler400(request, exception=None):
    return error_response(request, 400, "VALIDATION_ERROR", "The request is not valid.")


def handler403(request, exception=None):
    return error_response(request, 403, "FORBIDDEN", "Not allowed.")


def handler404(request, exception=None):
    return error_response(request, 404, "NOT_FOUND", "Not found.")


def handler500(request):
    return error_response(request, 500, "INTERNAL", "Something went wrong.")
