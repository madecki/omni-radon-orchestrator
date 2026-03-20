.PHONY: help clone pull bootstrap dev stop logs

# Optional: tail a single service (e.g. make logs S=gateway)
S ?=

help: ## Show available commands
	@echo ""
	@echo "OmniRadon workspace commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo ""

clone: ## Clone all repositories (skips existing)
	@./scripts/clone.sh

pull: ## Pull latest changes in all repositories
	@./scripts/pull.sh

bootstrap: ## Clone repos and install all dependencies
	@./scripts/bootstrap.sh

dev: ## Start the full development stack
	@exec ./scripts/dev.sh

stop: ## Stop all running services
	@./scripts/stop.sh

logs: ## Tail logs: all services in one terminal (prefixed), or one if S=<name>
	@if [ -n "$(S)" ]; then ./scripts/logs.sh "$(S)"; else ./scripts/logs.sh; fi
