import math
import random
from typing import Dict, List, Optional

class ChurnPredictionModel:
    def __init__(self):
        # Weights for different feature importance
        self.feature_weights = {
            "payment_failures": 0.4,
            "login_frequency_drop": 0.25,
            "support_tickets": 0.15,
            "app_crashes": 0.1,
            "price_sensitivity": 0.1
        }

    def _extract_features(self, user_data: Dict) -> Dict:
        """
        Extract normalized features from raw user data using ETL extractor module.
        """
        from etl.extractors import ChurnSignalExtractor

        # Format input for ETL ChurnSignalExtractor if raw format passed
        signal_data = {
            "subscriber": user_data.get("subscriber", ""),
            "recentPaymentFailures": user_data.get("recent_payment_failures", 0),
            "baselineLoginsPerMonth": user_data.get("baseline_logins_per_month", 1),
            "recentLogins": user_data.get("recent_logins", 0),
            "openSupportTickets": user_data.get("open_support_tickets", 0),
            "priceSensitivityIndex": user_data.get("price_sensitivity_index", 0.5),
        }
        
        extractor = ChurnSignalExtractor()
        extracted_list = extractor.extract({"churn_signals": [signal_data]})
        extracted = extracted_list[0] if extracted_list else user_data

        features = {}
        # Normalize payment failures (0 to 1)
        features["payment_failures"] = min(extracted.get("recent_payment_failures", 0) / 3.0, 1.0)
        
        # Login frequency drop calculated by ETL extractor
        features["login_frequency_drop"] = extracted.get("login_frequency_drop", 0.0)
        
        # Normalize support tickets
        features["support_tickets"] = min(extracted.get("open_support_tickets", 0) / 2.0, 1.0)
        
        # Add random noise for simulation
        features["app_crashes"] = random.uniform(0, 0.2)
        features["price_sensitivity"] = extracted.get("price_sensitivity_index", 0.5)
        
        return features

    def predict_churn(self, subscriber_address: str, user_data: Dict) -> Dict:
        """
        Predict churn probability and return risk scoring.
        """
        features = self._extract_features(user_data)
        
        # Calculate risk score (0.0 to 1.0)
        risk_score = 0.0
        for feature, value in features.items():
            risk_score += value * self.feature_weights.get(feature, 0.0)
            
        # Determine risk level
        if risk_score >= 0.7:
            risk_level = "High"
        elif risk_score >= 0.4:
            risk_level = "Medium"
        else:
            risk_level = "Low"
            
        # Extract top risk factors for explainability
        sorted_factors = sorted(features.items(), key=lambda x: x[1] * self.feature_weights.get(x[0], 0), reverse=True)
        top_factors = [
            {"factor": factor[0], "impact": round(factor[1] * self.feature_weights.get(factor[0], 0), 2)} 
            for factor in sorted_factors if factor[1] > 0.1
        ]
        
        return {
            "subscriber": subscriber_address,
            "churn_probability": round(risk_score, 4),
            "risk_level": risk_level,
            "risk_factors": top_factors,
            "recommended_action": self._get_recommended_action(risk_level, top_factors)
        }
        
    def _get_recommended_action(self, risk_level: str, top_factors: List[Dict]) -> str:
        if risk_level == "Low":
            return "No action needed. Monitor normal activity."
            
        primary_factor = top_factors[0]["factor"] if top_factors else "unknown"
        
        if primary_factor == "payment_failures":
            return "Send payment method update reminder with a 5% discount offer."
        elif primary_factor == "login_frequency_drop":
            return "Send re-engagement email highlighting new features."
        elif primary_factor == "support_tickets":
            return "Prioritize open support tickets for immediate resolution."
        else:
            return "Offer a 1-month free subscription to retain user."


class RevenueForecastModel:
    def forecast(self, observations: List[Dict], horizon: int = 3) -> List[Dict]:
        values = [float(item.get("revenue", 0)) for item in observations]
        if not values:
            return []

        latest = values[-1]
        deltas = [values[index] - values[index - 1] for index in range(1, len(values))]
        average_delta = sum(deltas) / len(deltas) if deltas else 0
        variance = (
            sum((delta - average_delta) ** 2 for delta in deltas) / len(deltas)
            if deltas
            else max(latest * 0.05, 1)
        )
        deviation = math.sqrt(variance)

        forecast = []
        for step in range(1, horizon + 1):
            expected = max(0, latest + average_delta * step)
            confidence = deviation * math.sqrt(step) * 1.96
            forecast.append({
                "period": f"forecast_{step}",
                "expected_revenue": round(expected, 2),
                "lower_bound": round(max(0, expected - confidence), 2),
                "upper_bound": round(expected + confidence, 2),
            })
        return forecast

if __name__ == "__main__":
    model = ChurnPredictionModel()
    test_data = {
        "recent_payment_failures": 2,
        "baseline_logins_per_month": 20,
        "recent_logins": 5,
        "open_support_tickets": 1,
        "price_sensitivity_index": 0.8
    }
    prediction = model.predict_churn("0xDEF456", test_data)
    print(f"Churn Prediction: {prediction}")
