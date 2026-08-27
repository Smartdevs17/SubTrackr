import os
import json
from typing import Dict, Any

class ModelRegistry:
    def __init__(self, storage_dir: str = "./models"):
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)
        
    def save_model(self, model_id: str, model_data: Dict[str, Any]):
        file_path = os.path.join(self.storage_dir, f"{model_id}.json")
        with open(file_path, "w") as f:
            json.dump(model_data, f)
            
    def load_model(self, model_id: str) -> Dict[str, Any]:
        file_path = os.path.join(self.storage_dir, f"{model_id}.json")
        if not os.path.exists(file_path):
            return None
        with open(file_path, "r") as f:
            return json.load(f)
            
    def retrain_model(self, new_data: list):
        """Simulate a retraining pipeline updating feature weights via ETL module"""
        try:
            from etl.pipeline import ETLPipeline
            pipeline = ETLPipeline()
            pipeline.run(source_data={"churn_signals": new_data} if new_data else None)
        except Exception:
            pass

        new_version = "v1.1"
        self.save_model(new_version, {
            "version": new_version,
            "feature_weights": {
                "payment_failures": 0.45,
                "login_frequency_drop": 0.2,
                "support_tickets": 0.15,
                "app_crashes": 0.1,
                "price_sensitivity": 0.1
            }
        })
        return new_version

registry = ModelRegistry()
