import unittest

from subtrackr import SubTrackrClient


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
        client = SubTrackrClient("test-key", base_url="https://example.test")
        session = FakeSession()
        client.session = session

        self.assertEqual(client.create_plan("GMERCHANT", "Pro", 100, "TOKEN", "Monthly"), 1)

        self.assertEqual(session.calls[0][0], "POST")
        self.assertEqual(session.calls[0][1], "https://example.test/create_plan")
        self.assertEqual(session.calls[0][3]["interval"], "Monthly")


if __name__ == "__main__":
    unittest.main()
