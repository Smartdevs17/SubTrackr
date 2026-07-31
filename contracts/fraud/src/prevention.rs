//! Prevention Recommendations Module
//!
//! Generates on-chain fraud prevention recommendations based on a subscriber's
//! risk score. Recommendations are structured data that the UI layer can
//! display and track.

#![no_std]

use soroban_sdk::{contracttype, Env, String, Vec};

/// Severity level of a prevention recommendation (0 = low, 100 = critical).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PreventionRecommendation {
    /// Recommendation identifier, unique within a response.
    pub id: u32,
    /// Short human-readable title.
    pub title: String,
    /// Detailed description of the recommended action.
    pub description: String,
    /// Category slug (e.g. "velocity", "geo", "device", "chargeback", "account").
    pub category: String,
    /// Severity score 0–100.  Higher = more urgent.
    pub severity: u32,
    /// Estimated percentage reduction in risk if recommendation is implemented.
    pub impact_score: u32,
}

/// Return a set of prevention recommendations tailored to `risk_score`.
///
/// # Arguments
/// * `env`        – Soroban environment
/// * `risk_score` – Current total risk score for the subscriber (0–100)
///
/// # Returns
/// A `Vec<PreventionRecommendation>` sorted by `severity` descending.
pub fn get_prevention_recommendations(
    env: &Env,
    risk_score: u32,
) -> Vec<PreventionRecommendation> {
    let mut recs: Vec<PreventionRecommendation> = Vec::new(env);

    // Always recommend velocity rate-limiting
    recs.push_back(PreventionRecommendation {
        id: 1,
        title: String::from_str(env, "Rate-limit subscription creation"),
        description: String::from_str(
            env,
            "Limit each subscriber to 3 new subscriptions per 24-hour window to curb velocity fraud.",
        ),
        category: String::from_str(env, "velocity"),
        severity: velocity_severity(risk_score),
        impact_score: 35,
    });

    // Recommend chargeback blocking for elevated risk
    if risk_score >= 30 {
        recs.push_back(PreventionRecommendation {
            id: 2,
            title: String::from_str(env, "Auto-block on 2+ chargebacks"),
            description: String::from_str(
                env,
                "Subscribers with two or more chargebacks in 90 days should be automatically blocked from new subscriptions.",
            ),
            category: String::from_str(env, "chargeback"),
            severity: chargeback_severity(risk_score),
            impact_score: 45,
        });
    }

    // Recommend geo verification for medium-high risk
    if risk_score >= 40 {
        recs.push_back(PreventionRecommendation {
            id: 3,
            title: String::from_str(env, "Require geo verification for cross-border access"),
            description: String::from_str(
                env,
                "Enforce OTP or email confirmation when a subscriber accesses from a country other than their home country.",
            ),
            category: String::from_str(env, "geo"),
            severity: geo_severity(risk_score),
            impact_score: 25,
        });
    }

    // Recommend device binding for medium-high risk
    if risk_score >= 40 {
        recs.push_back(PreventionRecommendation {
            id: 4,
            title: String::from_str(env, "Bind trusted device fingerprints"),
            description: String::from_str(
                env,
                "Capture a trusted device at registration and alert or block payments from unrecognised devices.",
            ),
            category: String::from_str(env, "device"),
            severity: device_severity(risk_score),
            impact_score: 20,
        });
    }

    // Recommend tighter rules for new accounts at high risk
    if risk_score >= 50 {
        recs.push_back(PreventionRecommendation {
            id: 5,
            title: String::from_str(env, "Lower flag threshold for new accounts"),
            description: String::from_str(
                env,
                "Apply a flag threshold of 35 instead of 50 for accounts younger than 7 days.",
            ),
            category: String::from_str(env, "account"),
            severity: account_severity(risk_score),
            impact_score: 28,
        });
    }

    // Recommend model drift monitoring at all times
    recs.push_back(PreventionRecommendation {
        id: 6,
        title: String::from_str(env, "Enable model drift monitoring"),
        description: String::from_str(
            env,
            "Alert the fraud team when the false-positive rate exceeds 20% so rule weights can be recalibrated.",
        ),
        category: String::from_str(env, "monitoring"),
        severity: 20_u32.saturating_add(risk_score / 5).min(40),
        impact_score: 15,
    });

    recs
}

// ── Severity helpers ──────────────────────────────────────────────────────────

fn velocity_severity(risk: u32) -> u32 {
    if risk >= 80 { 90 } else if risk >= 50 { 70 } else if risk >= 30 { 50 } else { 30 }
}

fn chargeback_severity(risk: u32) -> u32 {
    if risk >= 80 { 100 } else if risk >= 50 { 80 } else { 60 }
}

fn geo_severity(risk: u32) -> u32 {
    if risk >= 80 { 70 } else if risk >= 50 { 55 } else { 40 }
}

fn device_severity(risk: u32) -> u32 {
    if risk >= 80 { 65 } else if risk >= 50 { 50 } else { 35 }
}

fn account_severity(risk: u32) -> u32 {
    if risk >= 80 { 75 } else { 55 }
}
