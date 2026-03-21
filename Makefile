.PHONY: help clone pull bootstrap dev stop logs

# Optional: tail a single service (e.g. make logs S=gateway)
S ?=

help: ## Show available commands
	@node run.mjs help

clone: ## Clone all repositories (skips existing)
	@node run.mjs clone

pull: ## Pull latest changes in all repositories
	@node run.mjs pull

bootstrap: ## Clone repos and install all dependencies
	@node run.mjs bootstrap

dev: ## Start the full development stack
	@node run.mjs dev

stop: ## Stop all running services
	@node run.mjs stop

logs: ## Tail logs: all services in one terminal (prefixed), or one if S=<name>
	@node run.mjs logs $(S)
