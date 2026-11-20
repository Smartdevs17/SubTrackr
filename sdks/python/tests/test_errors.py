import unittest

from subtrackr import ApiError, AuthenticationError, parse_error_body, raise_for_response


class FakeResponse:
    def __init__(self, status_code, body=None, reason="Reason", raises=False):
        self.status_code = status_code
        self._body = body
        self.reason = reason
        self._raises = raises

    def json(self):
        if self._raises:
            raise ValueError("not json")
        return self._body


class ParseErrorBodyTest(unittest.TestCase):
    def test_canonical_envelope(self):
        info = parse_error_body(
            {
                "success": False,
                "error": {"code": "VALIDATION", "message": "bad", "details": {"amount": "positive"}},
                "meta": {"requestId": "r1"},
            },
            "fallback",
        )
        self.assertEqual(info["message"], "bad")
        self.assertEqual(info["code"], "VALIDATION")
        self.assertEqual(info["details"], {"amount": "positive"})
        self.assertEqual(info["request_id"], "r1")

    def test_legacy_message_code(self):
        info = parse_error_body({"message": "m", "code": "c"}, "f")
        self.assertEqual((info["message"], info["code"]), ("m", "c"))

    def test_legacy_error_string(self):
        self.assertEqual(parse_error_body({"error": "oops"}, "f")["message"], "oops")

    def test_fallbacks(self):
        for body in (None, {}, "html", {"error": {"message": ""}}):
            self.assertEqual(parse_error_body(body, "fb")["message"], "fb")


class RaiseForResponseTest(unittest.TestCase):
    def test_success_does_not_raise(self):
        raise_for_response(FakeResponse(204))

    def test_api_error_carries_envelope_fields(self):
        body = {"error": {"code": "NOT_FOUND", "message": "gone"}, "meta": {"requestId": "rid"}}
        with self.assertRaises(ApiError) as ctx:
            raise_for_response(FakeResponse(404, body))
        e = ctx.exception
        self.assertEqual((e.status_code, e.code, e.message, e.request_id), (404, "NOT_FOUND", "gone", "rid"))
        self.assertFalse(e.retryable)

    def test_401_is_authentication_error(self):
        with self.assertRaises(AuthenticationError):
            raise_for_response(FakeResponse(401, {"error": {"message": "no"}}))

    def test_non_json_body_uses_reason(self):
        with self.assertRaises(ApiError) as ctx:
            raise_for_response(FakeResponse(503, raises=True, reason="Service Unavailable"))
        self.assertEqual(ctx.exception.message, "Service Unavailable")
        self.assertTrue(ctx.exception.retryable)


if __name__ == "__main__":
    unittest.main()
