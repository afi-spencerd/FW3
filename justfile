# fw3 task runner — thin wrappers over the existing pnpm/turbo scripts.
# Run `just` (or `just --list`) to see available recipes.

# List recipes
default:
    @just --list

# Hot-reload dev stack: API (watch) + web (Vite) + shared-types (watch)
dev:
    pnpm dev

# Run the full test suite across all packages
test:
    pnpm test

# Build everything, then run the compiled API (prod-style)
run: build
    node apps/api/dist/src/main.js

# Build all packages
build:
    pnpm build

# Type-check all packages
typecheck:
    pnpm typecheck

# Start local infra (SQL Server + Redis) via docker compose
db-up:
    pnpm db:up

# First-time / reset DB: create db, apply migrations, seed (run after db-up)
db-setup:
    pnpm --filter @fw3/api db:create
    pnpm --filter @fw3/api db:migrate:deploy
    pnpm --filter @fw3/api db:seed
