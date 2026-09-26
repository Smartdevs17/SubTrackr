# SubTrackr Contracts Makefile
# Provides fine-grained build targets per contract, feature-flag profiles,
# compilation benchmarks, and binary size reports.
#
# Prerequisites:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-opt       (optional — for post-processing)
#   cargo install twiggy          (optional — for WASM size analysis)
#
# Usage:
#   make build                   # Build all contracts (release, WASM)
#   make build-core              # Build core contracts only (smallest surface)
#   make build-full              # Build all contracts with all features
#   make build CONTRACT=subscription  # Build a single contract
#   make size-report             # Print WASM binary sizes
#   make bench-compile           # Measure per-crate compile times
#   make test                    # Run all tests (native target)
#   make check-features          # Verify feature-flag compilation paths
#   make clean                   # Remove build artefacts

SHELL := /bin/bash
TARGET := wasm32-unknown-unknown
CARGO  := cargo
PROFILE := release
BUILD_DIR := target/$(TARGET)/$(PROFILE)

# ── Core contracts (always deployed) ─────────────────────────────────────────
CORE_CONTRACTS := types storage proxy subscription

# ── All workspace contracts ───────────────────────────────────────────────────
ALL_CONTRACTS := $(CORE_CONTRACTS) api oracle fraud batch credit metering access_control security audit utils

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN  := \033[0;32m
YELLOW := \033[0;33m
CYAN   := \033[0;36m
RESET  := \033[0m

# =============================================================================
# BUILD TARGETS
# =============================================================================

.PHONY: build
build: ## Build all workspace contracts in release mode (WASM)
	@echo -e "$(CYAN)Building all contracts (release, WASM)...$(RESET)"
	$(CARGO) build --target $(TARGET) --profile $(PROFILE) --workspace
	@$(MAKE) _print-sizes

.PHONY: build-core
build-core: ## Build only core contracts (types, storage, proxy, subscription)
	@echo -e "$(CYAN)Building core contracts...$(RESET)"
	@for c in $(CORE_CONTRACTS); do \
		echo -e "  $(GREEN)→ $$c$(RESET)"; \
		$(CARGO) build --target $(TARGET) --profile $(PROFILE) -p subtrackr-$$c 2>/dev/null \
		|| $(CARGO) build --target $(TARGET) --profile $(PROFILE) -p $$c 2>/dev/null \
		|| true; \
	done
	@$(MAKE) _print-sizes FILTER=core

.PHONY: build-full
build-full: ## Build subscription with all optional features enabled
	@echo -e "$(CYAN)Building subscription (all features)...$(RESET)"
	$(CARGO) build --target $(TARGET) --profile $(PROFILE) \
		-p subtrackr-subscription \
		--features subtrackr-subscription/full
	@$(MAKE) _print-sizes

.PHONY: build-minimal
build-minimal: ## Build subscription with no optional features (smallest binary)
	@echo -e "$(CYAN)Building subscription (minimal — no optional features)...$(RESET)"
	$(CARGO) build --target $(TARGET) --profile $(PROFILE) \
		-p subtrackr-subscription \
		--no-default-features
	@$(MAKE) _print-sizes

# Single-contract build:  make build CONTRACT=subscription
.PHONY: build-one
build-one:
ifdef CONTRACT
	@echo -e "$(CYAN)Building $(CONTRACT)...$(RESET)"
	$(CARGO) build --target $(TARGET) --profile $(PROFILE) -p subtrackr-$(CONTRACT) \
	|| $(CARGO) build --target $(TARGET) --profile $(PROFILE) -p $(CONTRACT)
else
	@echo "Usage: make build-one CONTRACT=<crate-name>"
	@exit 1
endif

# =============================================================================
# TESTING
# =============================================================================

.PHONY: test
test: ## Run all workspace tests (native target — no WASM needed)
	$(CARGO) test --workspace

.PHONY: test-features
test-features: ## Test each feature flag combination for the subscription crate
	@echo -e "$(CYAN)Testing feature: default (no optional features)$(RESET)"
	$(CARGO) test -p subtrackr-subscription --no-default-features --features testutils
	@echo -e "$(CYAN)Testing feature: oracle$(RESET)"
	$(CARGO) test -p subtrackr-subscription --no-default-features --features "oracle,testutils"
	@echo -e "$(CYAN)Testing feature: extended$(RESET)"
	$(CARGO) test -p subtrackr-subscription --no-default-features --features "extended,testutils"
	@echo -e "$(CYAN)Testing feature: full$(RESET)"
	$(CARGO) test -p subtrackr-subscription --features "full,testutils"

.PHONY: check-features
check-features: ## Verify each feature flag compiles cleanly (cargo check only)
	@echo -e "$(CYAN)Checking subscription feature combinations...$(RESET)"
	$(CARGO) check --target $(TARGET) -p subtrackr-subscription --no-default-features
	$(CARGO) check --target $(TARGET) -p subtrackr-subscription --features oracle
	$(CARGO) check --target $(TARGET) -p subtrackr-subscription --features extended
	$(CARGO) check --target $(TARGET) -p subtrackr-subscription --features "oracle,extended"
	$(CARGO) check --target $(TARGET) -p subtrackr-subscription --features full
	@echo -e "$(GREEN)All feature combinations pass cargo check.$(RESET)"

# =============================================================================
# CODE QUALITY
# =============================================================================

.PHONY: fmt
fmt: ## Check formatting across the workspace
	$(CARGO) fmt --all -- --check

.PHONY: fmt-fix
fmt-fix: ## Auto-format all source files
	$(CARGO) fmt --all

.PHONY: clippy
clippy: ## Run clippy lints across the workspace
	$(CARGO) clippy --workspace --all-targets -- -D warnings

# =============================================================================
# BINARY SIZE ANALYSIS
# =============================================================================

.PHONY: size-report
size-report: build ## Print WASM binary sizes with delta vs. baseline
	@$(MAKE) _print-sizes VERBOSE=1

.PHONY: size-compare
size-compare: ## Compare minimal vs. full feature build sizes
	@echo -e "$(CYAN)=== Minimal build ===$(RESET)"
	@$(MAKE) build-minimal --no-print-directory 2>/dev/null
	@ls -lh $(BUILD_DIR)/*.wasm 2>/dev/null | awk '{print $$5, $$9}' | sed 's|$(BUILD_DIR)/||' > /tmp/size_minimal.txt
	@echo -e "$(CYAN)=== Full build ===$(RESET)"
	@$(MAKE) build-full --no-print-directory 2>/dev/null
	@ls -lh $(BUILD_DIR)/*.wasm 2>/dev/null | awk '{print $$5, $$9}' | sed 's|$(BUILD_DIR)/||' > /tmp/size_full.txt
	@echo ""
	@echo -e "$(YELLOW)Binary size comparison (minimal vs. full features):$(RESET)"
	@echo -e "| WASM | Minimal | Full |"
	@echo -e "|------|---------|------|"
	@paste /tmp/size_minimal.txt /tmp/size_full.txt 2>/dev/null \
		| awk '{printf "| %-40s | %s | %s |\n", $$2, $$1, $$3}' \
		|| echo "(run make build-minimal && make build-full first)"

.PHONY: twiggy
twiggy: build ## Run twiggy to analyse what contributes to WASM binary size
	@if ! command -v twiggy &>/dev/null; then \
		echo "twiggy not found. Install with: cargo install twiggy"; \
		exit 1; \
	fi
	@for f in $(BUILD_DIR)/subtrackr_*.wasm; do \
		echo -e "$(YELLOW)=== $$f ===$(RESET)"; \
		twiggy top -n 15 "$$f" || true; \
	done

.PHONY: wasm-opt
wasm-opt: build ## Run wasm-opt post-processor for additional size reduction
	@if ! command -v wasm-opt &>/dev/null; then \
		echo "wasm-opt not found. Install binaryen: https://github.com/WebAssembly/binaryen"; \
		exit 1; \
	fi
	@for f in $(BUILD_DIR)/subtrackr_*.wasm; do \
		echo -e "$(CYAN)Optimising $$f...$(RESET)"; \
		wasm-opt -Oz --strip-debug --strip-producers --vacuum "$$f" -o "$${f%.wasm}.opt.wasm"; \
		echo -e "  Before: $$(wc -c < "$$f") bytes  After: $$(wc -c < "$${f%.wasm}.opt.wasm") bytes"; \
	done

# =============================================================================
# COMPILE-TIME BENCHMARKS
# =============================================================================

.PHONY: bench-compile
bench-compile: ## Measure per-crate incremental compile times
	@echo -e "$(CYAN)Measuring compilation times (clean build)...$(RESET)"
	$(CARGO) clean
	@echo ""
	@echo -e "$(YELLOW)Full workspace build time:$(RESET)"
	@time $(CARGO) build --target $(TARGET) --profile $(PROFILE) --workspace 2>&1 \
		| tail -3
	@echo ""
	@echo -e "$(YELLOW)Per-crate timings (requires nightly or cargo +stable -Z timings):$(RESET)"
	$(CARGO) build --target $(TARGET) --profile $(PROFILE) --workspace --timings 2>/dev/null \
		|| echo "  (--timings not available on this toolchain; use nightly for detailed output)"

.PHONY: bench-compile-crate
bench-compile-crate: ## Measure compile time for a single crate: make bench-compile-crate CONTRACT=subscription
ifdef CONTRACT
	@echo -e "$(CYAN)Timing compilation of $(CONTRACT) (clean)...$(RESET)"
	$(CARGO) clean -p subtrackr-$(CONTRACT) 2>/dev/null || $(CARGO) clean -p $(CONTRACT) 2>/dev/null || true
	@time $(CARGO) build --target $(TARGET) --profile $(PROFILE) \
		-p subtrackr-$(CONTRACT) 2>/dev/null \
		|| time $(CARGO) build --target $(TARGET) --profile $(PROFILE) -p $(CONTRACT)
else
	@echo "Usage: make bench-compile-crate CONTRACT=<name>"
endif

# =============================================================================
# DEPENDENCY ANALYSIS
# =============================================================================

.PHONY: dep-tree
dep-tree: ## Print the dependency tree for the subscription contract
	$(CARGO) tree -p subtrackr-subscription

.PHONY: dep-tree-full
dep-tree-full: ## Full dependency tree with feature flags
	$(CARGO) tree -p subtrackr-subscription --features full

.PHONY: dep-duplicates
dep-duplicates: ## List duplicate dependencies across the workspace
	$(CARGO) tree --duplicate

# =============================================================================
# CLEAN
# =============================================================================

.PHONY: clean
clean: ## Remove all build artefacts
	$(CARGO) clean

.PHONY: clean-wasm
clean-wasm: ## Remove only WASM artefacts (keep incremental cache)
	@rm -f $(BUILD_DIR)/*.wasm

# =============================================================================
# INTERNAL HELPERS
# =============================================================================

.PHONY: _print-sizes
_print-sizes:
	@echo ""
	@echo -e "$(YELLOW)WASM binary sizes:$(RESET)"
	@printf "%-50s %10s\n" "Contract" "Size"
	@printf "%-50s %10s\n" "--------" "----"
	@if ls $(BUILD_DIR)/*.wasm 2>/dev/null | head -1 | grep -q wasm; then \
		for f in $(BUILD_DIR)/*.wasm; do \
			size=$$(wc -c < "$$f"); \
			kb=$$(echo "scale=1; $$size/1024" | bc 2>/dev/null || echo "?"); \
			name=$$(basename "$$f"); \
			printf "%-50s %9s KB\n" "$$name" "$$kb"; \
		done; \
	else \
		echo "  (no WASM files found — run make build first)"; \
	fi
	@echo ""

.PHONY: help
help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "$(CYAN)%-25s$(RESET) %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
