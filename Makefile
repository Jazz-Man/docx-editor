# SuperDoc developer facade.
#
# Mechanics live in package.json scripts and scripts/*.mjs; this file adds
# naming, grouping, ordering, and environment checks on top. The clean and
# reset recipes are the exception: they own their find-based cleanup logic
# here directly. All targets are phony actions - this is a facade, not a
# build system.
#
# Orbit-only scripts (no-ops in a public clone, kept for the private
# checkout that shares this manifest): test:sdk-python-document-host,
# update-preset-geometry, and the sdk/mcp/cli legs of the orchestrators
# (guarded there with existsSync).

SHELL := /bin/bash
.DEFAULT_GOAL := help

ifeq ($(wildcard pnpm-workspace.yaml),)
$(error Run make from the workspace root - the directory that holds pnpm-workspace.yaml. In an Orbit checkout that is superdoc/public, not the Orbit root.)
endif

# ----------------------------------------------------------------- Setup ---

.PHONY: help check-env install reset

## Setup
help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^## / {printf "\n%s\n", substr($$0, 4)} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Version checks - make-native: $(shell) reads, $(subst)/$(word) split the
# version strings, $(filter) pattern-matches the major against the repo's
# own pins (.nvmrc, packageManager). No inline scripts.
NODE_PIN   := $(strip $(shell cat .nvmrc 2>/dev/null))
NODE_MAJOR := $(word 1,$(subst ., ,$(NODE_PIN)))
NODE_V     := $(shell node -v 2>/dev/null)
NODE_OK    := $(filter v$(NODE_MAJOR).%,$(NODE_V))

PNPM_PIN   := $(subst pnpm@,,$(shell grep -o 'pnpm@[0-9][0-9.]*' package.json | head -1))
PNPM_MAJOR := $(word 1,$(subst ., ,$(PNPM_PIN)))
PNPM_V     := $(shell pnpm -v 2>/dev/null)
PNPM_OK    := $(filter $(PNPM_MAJOR).%,$(PNPM_V))

BUN_V      := $(shell bun -v 2>/dev/null)

# usage: $(call require_version,<name>,<current>,<ok-var>,<pin>)
define require_version
$(if $($(3)),,$(error $(1) $(2) does not satisfy the repo pin $(4)))
endef

check-env: ## Check node/pnpm against repo pins; bun availability
	@echo "node $(NODE_V) (pin $(NODE_PIN) via .nvmrc)"
	$(call require_version,node,$(NODE_V),NODE_OK,$(NODE_PIN))
	@echo "pnpm $(PNPM_V) (pin pnpm@$(PNPM_PIN) via packageManager)"
	$(call require_version,pnpm,$(PNPM_V),PNPM_OK,$(PNPM_PIN))
	$(if $(BUN_V),,@echo "note: bun not found - required by test and ci-local (>= 1.3.13)")

# Config gates must run BEFORE pnpm install: a rejected config would
# already have steered resolution (same order scripts/oss-local-ci.mjs
# enforces in its setup lane).
install: check-env ## Version checks, config gates, then pnpm install
	@pnpm run check:pnpm-config && pnpm run check:vite-plus && pnpm run check:public-ci && pnpm install

reset: ## DESTRUCTIVE: wipe dists, node_modules, stray package-lock.json; reinstall
	@find packages shared -type d -name dist -prune -exec rm -rf {} +
	@find . -name 'node_modules' -type d -prune -exec rm -rf {} +
	@find . -name 'package-lock.json' -type f -not -path './tests/consumer-typecheck/*' -delete
	@pnpm install

# ------------------------------------------------------------ Development ---

.PHONY: dev dev-docs watch

## Development
dev: ## Run the SuperDoc dev editor
	@pnpm run dev

dev-docs: ## Run editor + CDN watch + docs site concurrently
	@pnpm run dev:docs

watch: ## Watch-build the SuperDoc ES output
	@pnpm run watch

# ------------------------------------------------------------------ Build ---

.PHONY: build build-clean clean rebuild-types pack pack-es

## Build
build: ## Build SuperDoc (npm + CDN surfaces)
	@pnpm run build:superdoc

clean: ## Remove every packages/**/dist and shared/**/dist (incl. nested)
	@find packages shared -type d -name dist -prune -exec rm -rf {} +

# Ordered composite - run without -j.
build-clean: clean build ## Clean, rebuild, then force a full type-check
	@pnpm run type-check:force

rebuild-types: ## Rebuild type outputs serially (filter order matters)
	@pnpm run rebuild:types

# The sealed tgz needs the d.ts of all referenced projects; pack-es alone
# skips types.
pack: type-check pack-es ## Type-check, then sealed superdoc.tgz

pack-es: ## Pack superdoc.tgz WITHOUT type-check
	@pnpm run pack:es

# ------------------------------------------------------------------- Test ---

.PHONY: test test-superdoc test-all test-slow test-cov test-bench test-docx-privacy

## Test
test: ## Full suite: vitest projects + bun packages (needs bun >= 1.3.13)
	$(if $(BUN_V),,$(error bun >= 1.3.13 is required by test - https://bun.sh))
	@pnpm test

test-superdoc: ## Vitest for packages/superdoc only
	@pnpm run test:superdoc

test-all: ## Vitest projects only (no bun packages)
	@pnpm run test:all

test-slow: ## Memory-profile suite (@superdoc/layout-tests)
	@pnpm run test:slow

test-cov: ## Coverage report into coverage/
	@pnpm run test:cov

test-bench: ## Benchmarks (VITEST_BENCH=true)
	@pnpm run test:bench

test-docx-privacy: ## DOCX fixture privacy gate (vitest twin)
	@pnpm run test:docx-privacy

# --------------------------------------------------------------- Quality ---

.PHONY: lint lint-fix format format-check type-check type-check-force check-all

## Quality
lint: ## vp lint (oxlint) over the workspace
	@pnpm run lint

lint-fix: ## vp lint --fix
	@pnpm run lint:fix

format: ## vp fmt (oxfmt)
	@pnpm run format

format-check: ## Format-coverage gate + vp fmt --check
	@pnpm run format:check

type-check: ## tsc -b over tsconfig.references.json (13 projects)
	@pnpm run type-check

type-check-force: ## tsc -b --force
	@pnpm run type-check:force

# Ordered composite - run without -j.
check-all: format lint-fix test ## format + lint:fix + test

# -------------------------------------------------------- Public API gate ---

.PHONY: check-public check-public-superdoc docapi-sync docapi-check docapi-sync-check

## Public API
# Ordered composite - run without -j.
check-public: check-public-superdoc docapi-check ## Both public-contract gates

check-public-superdoc: ## 13-stage superdoc public-surface gate
	@pnpm run check:public:superdoc

docapi-sync: ## Generate document-api contract outputs
	@pnpm run docapi:sync

docapi-check: ## Check docapi parity (no prior generate needed)
	@pnpm run docapi:check

# Ordered composite - run without -j.
docapi-sync-check: docapi-sync docapi-check ## Generate, then check

# ------------------------------------------------------------- CI lanes ---

.PHONY: ci-local ci-list ci-plan ci-lane ci-stage

## CI lanes
ci-local: ## Run the full local CI mirror
	@pnpm run ci:local

ci-list: ## List lanes and stages
	@node scripts/oss-local-ci.mjs --list

ci-plan: ## Show the execution plan
	@node scripts/oss-local-ci.mjs --plan

ci-lane: ## make ci-lane LANE=ci-superdoc
	@node scripts/oss-local-ci.mjs --lane $(LANE)

ci-stage: ## make ci-stage LANE=ci-superdoc STAGE=lint
	@node scripts/oss-local-ci.mjs --lane $(LANE) --stage $(STAGE)

# --------------------------------------------------------------- Release ---

.PHONY: release publish local-publish

## Release
release: ## semantic-release for packages/superdoc (type-checks first)
	@pnpm run release

publish: ## Sealed-tarball publisher - 1.x only by policy
	@pnpm run publish

local-publish: ## Publish -local.N versions to verdaccio (:4873 must run)
	@pnpm run local:publish

## Orbit-only (private checkout)
