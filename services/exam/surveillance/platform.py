"""Calls to the platform's internal routes (contract §5): direct, 3 tries, idempotency key.

ponytail: no outbox yet (deferred); a platform outage longer than the retries loses the call (logged).
"""

import json
import logging
import time
import urllib.request

from django.conf import settings

logger = logging.getLogger("exam.platform")


def send(path, body, tries=3):
    data = json.dumps(body).encode()
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(
            f"{settings.PLATFORM_INTERNAL_URL}/internal/exam/{path}", data=data, method="POST",
            headers={"Content-Type": "application/json", "X-Service-Token": settings.SERVICE_TOKEN_EXAM},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                if res.status < 300:
                    return True
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500 and exc.code != 429:
                logger.warning("platform refused call", extra={"path": path, "status": exc.code})
                return False
        except OSError:
            pass
        time.sleep(0.5 * 2 ** attempt)
    logger.warning("platform call failed", extra={"path": path, "key": body.get("idempotencyKey")})
    return False


def after_commit(path, body):
    from django.db import transaction
    import threading
    transaction.on_commit(lambda: threading.Thread(target=send, args=(path, body), daemon=True).start())
