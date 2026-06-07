"""
Retraining pipeline — run manually or via CI cron.
Usage: python retrain.py --model churn|recommendations|pricing
"""
import argparse
import json
import logging
import os
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REGISTRY_FILE = os.path.join(os.path.dirname(__file__), "model_versions.json")


def bump_version(current: str) -> str:
    parts = current.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def retrain_churn():
    """Placeholder: load new labelled data, re-fit weights, validate accuracy."""
    logger.info("Retraining churn model...")
    # In production: load data from feature store, retrain, evaluate on holdout set
    time.sleep(0.5)  # simulate work
    logger.info("Churn model retrained. Accuracy: 0.84 (simulated)")
    return True


def retrain_recommendations():
    logger.info("Retraining recommendation model...")
    time.sleep(0.5)
    logger.info("Recommendation model retrained. Accuracy: 0.81 (simulated)")
    return True


def retrain_pricing():
    logger.info("Retraining pricing model...")
    time.sleep(0.5)
    logger.info("Pricing model retrained. (simulated)")
    return True


TRAINERS = {
    "churn": retrain_churn,
    "recommendations": retrain_recommendations,
    "pricing": retrain_pricing,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=list(TRAINERS.keys()) + ["all"], default="all")
    args = parser.parse_args()

    with open(REGISTRY_FILE) as f:
        versions = json.load(f)

    targets = list(TRAINERS.keys()) if args.model == "all" else [args.model]

    for model_name in targets:
        success = TRAINERS[model_name]()
        if success:
            old = versions.get(model_name, "1.0.0")
            versions[model_name] = bump_version(old)
            logger.info(f"{model_name}: {old} → {versions[model_name]}")

    with open(REGISTRY_FILE, "w") as f:
        json.dump(versions, f, indent=2)

    logger.info("Registry updated. Restart the ML service to load new versions.")


if __name__ == "__main__":
    main()
