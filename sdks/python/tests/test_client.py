import unittest

from subtrackr import ApiError, SubTrackrClient


class FakeResponse:
    ok = True
    status_code = 200

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self):
        self.calls = []

    def request(self, method, url, headers=None, json=None):
        self.calls.append((method, url, headers, json))
        return FakeResponse(1)


class SubTrackrClientTest(unittest.TestCase):
    def test_create_plan_posts_contract_payload(self):
        client = SubTrackrClient(base_url="https://example.test", api_key="test-key")
        session = FakeSession()
        client.session = session

        self.assertEqual(client.create_plan("GMERCHANT", "Pro", 100, "TOKEN", "Monthly"), 1)

        self.assertEqual(session.calls[0][0], "POST")
        self.assertEqual(session.calls[0][1], "https://example.test/create_plan")
        self.assertEqual(session.calls[0][3]["interval"], "Monthly")

    def test_requests_carry_auth_and_version_headers(self):
        client = SubTrackrClient(base_url="https://example.test/", api_key="test-key")
        session = FakeSession()
        client.session = session

        client.list_subscriptions()

        method, url, headers, body = session.calls[0]
        self.assertEqual((method, url, body), ("GET", "https://example.test/subscriptions", None))
        self.assertEqual(headers["X-API-Key"], "test-key")
        self.assertIn("X-SDK-Version", headers)

    def test_error_responses_raise_api_error(self):
        class ErrorSession(FakeSession):
            def request(self, method, url, headers=None, json=None):
                response = FakeResponse({"error": {"code": "plan_exists", "message": "Plan exists"}})
                response.ok = False
                response.status_code = 409
                return response

        client = SubTrackrClient(base_url="https://example.test", api_key="test-key")
        client.session = ErrorSession()

        with self.assertRaises(ApiError) as ctx:
            client.create_plan("GMERCHANT", "Pro", 100, "TOKEN", "Monthly")
        self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
