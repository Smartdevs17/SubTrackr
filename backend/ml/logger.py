import json
import uuid
import datetime

class StructuredLogger:
    def __init__(self, name="ml-service"):
        self.name = name

    def _log(self, level, message, correlation_id=None, **kwargs):
        log_entry = {
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "level": level,
            "message": message,
            "service": self.name
        }
        if correlation_id:
            log_entry["correlationId"] = correlation_id
        
        if kwargs:
            log_entry.update(kwargs)
            
        print(json.dumps(log_entry))

    def debug(self, message, correlation_id=None, **kwargs):
        self._log("debug", message, correlation_id, **kwargs)

    def info(self, message, correlation_id=None, **kwargs):
        self._log("info", message, correlation_id, **kwargs)

    def warn(self, message, correlation_id=None, **kwargs):
        self._log("warn", message, correlation_id, **kwargs)

    def error(self, message, correlation_id=None, **kwargs):
        self._log("error", message, correlation_id, **kwargs)

logger = StructuredLogger()
