import json
from email.message import Message
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import pytest

from inference_client import (
    ChurnFeatures,
    ChurnPrediction,
    InferenceAPIError,
    InferenceClient,
    InferenceTransportError,
    RevenueObservation,
)


FEATURES = ChurnFeatures(1, 12, 8, 0, 0.4)


def response(payload):
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self):
            return json.dumps(payload).encode()

    return FakeResponse()


def prediction():
    return {
        "subscriber": "sub_1", "churn_probability": 0.3, "risk_level": "Low",
        "risk_factors": [], "recommended_action": "Monitor", "model_version": "v1.0",
    }


def test_predict_sends_typed_payload_headers_and_returns_typed_result():
    client = InferenceClient("http://ml.test/", api_key="secret")
    with patch("inference_client.urlopen", return_value=response(prediction())) as open_url:
        result = client.predict_churn("sub_1", FEATURES, correlation_id="trace-1")

    request = open_url.call_args.args[0]
    assert request.full_url == "http://ml.test/v1/churn/predict"
    assert request.get_header("X-api-key") == "secret"
    assert request.get_header("X-correlation-id") == "trace-1"
    assert json.loads(request.data)["user_data"] == FEATURES.to_dict()
    assert isinstance(result, ChurnPrediction)
    assert result.churn_probability == 0.3


def test_batch_preserves_per_item_failure():
    payload = {"model_version": "v1.0", "results": [prediction(), {"ok": False, "subscriber": "sub_2", "error": "bad"}]}
    with patch("inference_client.urlopen", return_value=response(payload)):
        result = InferenceClient().predict_churn_batch([("sub_1", FEATURES), ("sub_2", FEATURES)])
    assert isinstance(result.results[0], ChurnPrediction)
    assert result.results[1]["error"] == "bad"


def test_forecast_parses_rows_and_validates_input():
    rows = [{"period": "forecast_1", "expected_revenue": 12.0, "lower_bound": 10.0, "upper_bound": 14.0}]
    with patch("inference_client.urlopen", return_value=response(rows)):
        result = InferenceClient().forecast_revenue([RevenueObservation("p1", 10), RevenueObservation("p2", 12)])
    assert result[0].upper_bound == 14.0
    with pytest.raises(ValueError):
        InferenceClient().forecast_revenue([RevenueObservation("p1", 10)])


def test_http_errors_retain_status_and_correlation_id():
    headers = Message()
    headers["X-Correlation-ID"] = "server-trace"
    error = HTTPError("http://ml.test", 401, "Unauthorized", headers, None)
    error.fp = __import__("io").BytesIO(b'{"detail":"invalid token"}')
    with patch("inference_client.urlopen", side_effect=error):
        with pytest.raises(InferenceAPIError) as caught:
            InferenceClient().predict_churn("sub_1", FEATURES)
    assert caught.value.status_code == 401
    assert caught.value.correlation_id == "server-trace"
    assert "invalid token" in str(caught.value)


@pytest.mark.parametrize("failure", [URLError("offline"), TimeoutError("late")])
def test_network_errors_are_wrapped(failure):
    with patch("inference_client.urlopen", side_effect=failure):
        with pytest.raises(InferenceTransportError, match="Could not reach"):
            InferenceClient().health()


def test_malformed_success_response_is_reported():
    with patch("inference_client.urlopen", return_value=response({"subscriber": "sub_1"})):
        with pytest.raises(InferenceTransportError, match="Invalid churn"):
            InferenceClient().predict_churn("sub_1", FEATURES)
