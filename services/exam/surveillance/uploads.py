"""Streams an upload to a temporary file and stops it past MAX_CLIP_BYTES (no memory buffering)."""

from django.conf import settings
from django.core.files.uploadhandler import TemporaryFileUploadHandler

from .errors import ApiError


def too_large():
    return ApiError(413, "FILE_TOO_LARGE", "The clip is larger than 200 MB.")


class LimitedUploadHandler(TemporaryFileUploadHandler):
    def handle_raw_input(self, input_data, META, content_length, boundary, encoding=None):
        # Refuse before reading anything when the declared size is already too big
        # (64 kB allows for the multipart headers and the other fields).
        if content_length and content_length > settings.MAX_CLIP_BYTES + 64 * 1024:
            raise too_large()
        self.received = 0

    def receive_data_chunk(self, raw_data, start):
        self.received += len(raw_data)
        if self.received > settings.MAX_CLIP_BYTES:
            self.file.close()   # deletes the temporary file
            raise too_large()
        return super().receive_data_chunk(raw_data, start)
