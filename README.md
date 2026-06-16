# fw3 — ERP (rebuild)

TypeScript end-to-end ERP replacing the legacy PHP/Laravel + Vue + MSSQL system.
Thin Vue client, NestJS back-end, SQL Server, hybrid Prisma + raw-SQL data access,
BullMQ jobs, and an isolated QuickBooks Desktop (QBWC) integration.

> First vertical slice: **Inventory items** (CRUD + valuation + a QBWC round-trip),
> built multi-tenant from the ground up. See `docs/CONVENTIONS.md`.

## Layout

```
apps/
  api/            NestJS back-end — all business logic, permissions, accounting math
  web/            Vue 3 + Vite thin client
packages/
  shared-types/   zod schemas + TS contracts shared by api and web
compose.yaml      dev infra: SQL Server 2022 + Redis (rootless Podman)
flake.nix         pinned dev shell (Node 22, pnpm 11, Prisma engine for NixOS)
```

## Prerequisites

This repo targets a **NixOS** dev machine. The toolchain comes from the flake — there
is no global Node/pnpm.

- `direnv allow` once to auto-load the dev shell (or run `nix develop` manually).
- Rootless **Podman** provides `docker` / `docker compose`.

## First-time setup

```bash
direnv allow                      # loads Node 22 + pnpm 11 + Prisma engine env
cp .env.example .env              # then fill in OIDC + SESSION secrets
docker compose up -d              # start SQL Server + Redis
pnpm install
pnpm --filter @fw3/api db:create  # create the `fw3` database (idempotent)
pnpm --filter @fw3/api db:migrate # apply migrations
pnpm --filter @fw3/api db:seed    # seed one tenant, roles, demo items
pnpm dev                          # run api + web (+ shared-types watch)
```

## Key facts

- **Prisma 7** uses driver adapters — SQL Server via `@prisma/adapter-mssql`. The Rust
  query engine is gone at runtime; only `schema-engine` (from Nix) runs migrations.
- Money/quantity are `DECIMAL` in the DB and **decimal strings** over the wire — never
  floats. See `packages/shared-types/src/money.ts`.
- Multi-tenant: every row has `tenantId`; every query is tenant-scoped.
- Auth: OIDC (Microsoft Entra ID) → Redis-backed session; local RBAC tables.

See `docs/CONVENTIONS.md` before adding modules.
