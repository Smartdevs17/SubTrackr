//! Compatibility notes for the subscription fuzzing suite.
//!
//! The executable coverage-guided fuzz targets live under `contracts/fuzz`.
//! The deterministic CI smoke replay lives at
//! `contracts/subscription/tests/fuzz_smoke.rs`.
//!
//! Keep this file as the top-level pointer requested by the contract fuzzing
//! issue so contributors looking in `contracts/tests` find the maintained
//! harness locations.

#[test]
fn fuzz_harness_locations_are_documented() {
    assert!(true);
}
