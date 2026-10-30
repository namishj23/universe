"""JSON log lines. Callers log ids and counts only: never names, notes, file names or tokens."""

import json
import logging
import traceback

_STANDARD = set(vars(logging.LogRecord("", 0, "", 0, "", (), None))) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record):
        line = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        line.update({k: v for k, v in vars(record).items() if k not in _STANDARD})
        if record.exc_info:
            line["stack"] = "".join(traceback.format_exception(*record.exc_info))
        return json.dumps(line, default=str)
