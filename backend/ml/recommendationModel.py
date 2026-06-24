import math
import random
from typing import Dict, List, Optional

class RecommendationEngine:
    def __init__(self):
        # Mock product catalog/features for demonstration
        self.catalog = {
            "rec_1": {"name": "Premium VPN", "category": "Security", "price": 9.99},
            "rec_2": {"name": "Cloud Storage 1TB", "category": "Infrastructure", "price": 4.99},
            "rec_3": {"name": "Ad-Free Streaming", "category": "Entertainment", "price": 12.99},
            "rec_4": {"name": "Pro Productivity Suite", "category": "Productivity", "price": 19.99},
        }

    def _collaborative_filtering(self, subscriber_address: str, active_subs: List[str]) -> List[Dict]:
        """
        Mock collaborative filtering: users who bought X also bought Y.
        """
        # If user has productivity tools, recommend infrastructure
        recommendations = []
        if "pro_productivity_suite" in active_subs or len(active_subs) > 2:
            recommendations.append({"id": "rec_2", "score": 0.85})
        
        # If user has entertainment, recommend ad-free or security
        if "netflix" in active_subs or "spotify" in active_subs:
            recommendations.append({"id": "rec_3", "score": 0.92})
            recommendations.append({"id": "rec_1", "score": 0.76})
            
        return recommendations

    def _content_based_filtering(self, subscriber_address: str, user_profile: Dict) -> List[Dict]:
        """
        Mock content-based filtering: match user preferences with product attributes.
        """
        recommendations = []
        interests = user_profile.get("interests", [])
        for rec_id, product in self.catalog.items():
            if product["category"] in interests:
                recommendations.append({"id": rec_id, "score": 0.88})
        return recommendations

    def get_recommendations(self, subscriber_address: str, context: Dict) -> List[Dict]:
        """
        Combines collaborative and content-based filtering.
        """
        active_subs = context.get("active_subscriptions", [])
        user_profile = context.get("user_profile", {})
        
        cf_recs = self._collaborative_filtering(subscriber_address, active_subs)
        cb_recs = self._content_based_filtering(subscriber_address, user_profile)
        
        # Merge and deduplicate, prioritizing highest score
        merged = {}
        for rec in cf_recs + cb_recs:
            if rec["id"] not in merged or merged[rec["id"]]["score"] < rec["score"]:
                merged[rec["id"]] = rec
                
        # Sort by score descending
        sorted_recs = sorted(merged.values(), key=lambda x: x["score"], reverse=True)
        
        # Enrich with product details
        final_recs = []
        for rec in sorted_recs:
            product = self.catalog.get(rec["id"])
            if product:
                final_recs.append({
                    "id": rec["id"],
                    "name": product["name"],
                    "category": product["category"],
                    "price": product["price"],
                    "confidence_score": round(rec["score"], 2)
                })
                
        # Fallback if none found
        if not final_recs:
            final_recs.append({
                "id": "rec_1",
                "name": self.catalog["rec_1"]["name"],
                "category": self.catalog["rec_1"]["category"],
                "price": self.catalog["rec_1"]["price"],
                "confidence_score": 0.50
            })
            
        return final_recs

if __name__ == "__main__":
    engine = RecommendationEngine()
    test_context = {
        "active_subscriptions": ["netflix", "spotify"],
        "user_profile": {"interests": ["Security", "Infrastructure"]}
    }
    result = engine.get_recommendations("0xABC123", test_context)
    print(f"Recommendations: {result}")
