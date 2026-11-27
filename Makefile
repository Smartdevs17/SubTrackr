# One-command entry points for local development.
# Requires make and either pnpm (preferred) or npm.
SHELL := /bin/bash
PKG_MANAGER ?= $(shell command -v pnpm >/dev/null 2>&1 && echo pnpm || echo npm)

.PHONY: help dev test lint check

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort

dev: ## Install dependencies and start the development server
	./scripts/dev.sh

test: ## Run the test suite
	$(PKG_MANAGER) run test

lint: ## Run eslint across the repository
	$(PKG_MANAGER) run lint

check: ## Validate the developer scripts without running them
	bash -n scripts/dev.sh
	@$(MAKE) --no-print-directory help >/dev/null
