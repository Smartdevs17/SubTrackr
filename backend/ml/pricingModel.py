import math
import random
from typing import Dict, List, Optional

class PricingOptimizationEngine:
    def __init__(self):
        # Mock data for demonstration purposes
        self.competitor_prices = {
            "netflix": [10.99, 15.49, 22.99],
            "spotify": [5.99, 10.99, 16.99],
            "disney_plus": [7.99, 13.99],
            "youtube_premium": [13.99]
        }
        self.demand_factor = 1.0  # Current demand multiplier (1.0 = normal)
        self.market_volatility = 0.05
        
    def estimate_willingness_to_pay(self, usage_data: Dict) -> float:
        """
        Estimates the maximum a user might be willing to pay based on usage metrics.
        Factors: retention, frequency of use, feature depth.
        """
        # Logic: High usage and high retention = higher WTP
        base_wtp = usage_data.get("current_price", 10.0)
        retention_rate = usage_data.get("retention_rate", 0.5)
        usage_frequency = usage_data.get("sessions_per_week", 2)
        
        # Heuristic: Each session/week adds 5% value, retention adds up to 20%
        wtp = base_wtp * (1 + (usage_frequency * 0.05) + (retention_rate * 0.2))
        return round(wtp, 2)

    def calculate_optimal_price(self, subscription_id: str, context: Dict) -> Dict:
        """
        Calculates the optimal price based on several factors.
        """
        current_price = context.get("current_price", 10.0)
        competitor_avg = context.get("competitor_avg", current_price)
        demand = context.get("current_demand", 1.0)
        wtp_estimate = self.estimate_willingness_to_pay(context.get("usage_data", {}))
        
        price_floor = context.get("price_floor", current_price * 0.8)
        price_ceiling = context.get("price_ceiling", current_price * 1.5)
        
        # Core pricing formula:
        # Weighted average of WTP, Competitor Prices, and Demand-Adjusted current price
        target_price = (wtp_estimate * 0.4) + (competitor_avg * 0.4) + (current_price * demand * 0.2)
        
        # Apply limits
        optimal_price = max(price_floor, min(price_ceiling, target_price))
        
        return {
            "subscription_id": subscription_id,
            "optimal_price": round(optimal_price, 2),
            "factors": {
                "demand_impact": demand,
                "competitor_benchmark": competitor_avg,
                "willingness_to_pay": wtp_estimate
            },
            "recommendation": "Increase" if optimal_price > current_price else "Decrease" if optimal_price < current_price else "Maintain"
        }

    def get_price_recommendations(self, plan_id: str, historical_data: List[Dict]) -> List[Dict]:
        """
        Returns a range of price recommendations for a specific plan.
        Useful for A/B testing setup.
        """
        # Simulate base price from historical data
        base_price = historical_data[-1].get("price", 10.0) if historical_data else 10.0
        
        # Generate 3 tiers for A/B testing: Conservative, Balanced, Aggressive
        return [
            {
                "tier": "Conservative",
                "price": round(base_price * 0.95, 2),
                "reasoning": "Focus on high retention and volume."
            },
            {
                "tier": "Balanced",
                "price": round(base_price, 2),
                "reasoning": "Maintain current market position."
            },
            {
                "tier": "Aggressive",
                "price": round(base_price * 1.15, 2),
                "reasoning": "Maximize revenue for high-value segments."
            }
        ]

if __name__ == "__main__":
    # Simple test run
    engine = PricingOptimizationEngine()
    test_context = {
        "current_price": 14.99,
        "competitor_avg": 12.99,
        "current_demand": 1.2,
        "usage_data": {
            "retention_rate": 0.85,
            "sessions_per_week": 10
        },
        "price_floor": 9.99,
        "price_ceiling": 19.99
    }
    result = engine.calculate_optimal_price("sub_123", test_context)
    print(f"Optimal Price Analysis: {result}")
    
    recommendations = engine.get_price_recommendations("plan_gold", [{"price": 14.99}])
    print(f"A/B Test Recommendations: {recommendations}")
