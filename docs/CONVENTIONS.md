# fw3 conventions

These are the patterns every module copies. The first vertical slice (inventory)
establishes them; follow them rather than inventing per-module variations.

## Language & types

- TypeScript everywhere, `strict` + `noUncheckedIndexedAccess`. No `any` without a
  written reason. No business logic in the browser.
- Shared contracts live in `@fw3/shared-types` as **zod schemas**; TS types are
  `z.infer`-ed from them. The API validates input against these; the web client uses
  the same schemas for UX-level form validation. One source of truth, no drift.

## Money & numbers (financial safety)

- Money and quantity are SQL `DECIMAL(19,4)` / `DECIMAL(18,4)`, `Prisma.Decimal` in
  Node, and **decimal strings** in JSON. Never `number`. Never float math on money.
- All arithmetic on money/qty happens server-side with `Prisma.Decimal` (decimal.js),
  or — better — pushed into SQL Server (see Data access).

## Data access (hybrid, decided per query)

- **Prisma** for CRUD, lookups, single-entity reads/writes (~90%). Use relation loading
  (`include`/`select`) correctly to avoid N+1.
- **Hand-written SQL** for heavy aggregation (~10%): rollups, valuation, dashboards.
  Prefer a SQL Server **view** or stored proc; when inline use `$queryRaw` with the
  `Prisma.sql` tagged template (parameterized — never string concatenation). Map results
  to an explicit typed shape.
- If raw SQL starts creeping into routine reads, raise it — that's the signal to add
  Kysely for the read layer.

## Multi-tenancy

- Every persisted row has `tenantId`. Every query filters by the caller's tenant.
- Tenant id comes from the authenticated session via `TenantContext`, never from client
  input. Services receive it as an argument; they never read it from the request body.

## Authorization (RBAC)

- Guard endpoints by **permission** (`@RequirePermissions(PERMISSIONS.X)`), not role
  name. Permissions are defined once in `@fw3/shared-types`.
- The IdP (Entra) proves identity only. Roles/permissions live in our DB, keyed to the
  OIDC `sub`.

## Transactions & audit

- Any write touching money, quantity, valuation, or tax runs inside a DB transaction
  (`prisma.$transaction`) with DB-level constraints (CHECK / FK / unique) backing it up —
  app code is not the only guard.
- Mutations write an `AuditLog` row (actor, tenant, entity, action, before/after) in the
  same transaction.

## Module structure (NestJS)

```
src/<feature>/
  <feature>.controller.ts   HTTP + DTO validation + @RequirePermissions
  <feature>.service.ts      business logic, transactions, audit
  dto/                      zod-backed DTOs (via shared-types)
  <feature>.module.ts
```

- Cross-cutting infra (Prisma, auth, tenant context, audit) are NestJS providers in
  their own modules and injected — not imported ad hoc.
- The QBWC integration is sealed behind its own module; SOAP/qbXML types never leak out.
  It exposes a plain typed service interface to the rest of the app.

## Testing

- Move fast on plain CRUD. **Slow down and write real tests** for anything financial
  (valuation/qty/tax) and for the QB sync. Treat raw-SQL aggregations and qbXML
  build/parse as suspect-until-tested; QB sync is tested against recorded fixtures.

## Errors

- Throw Nest `HttpException` subclasses from controllers/services; never leak SQL or
  stack traces to clients. Validation failures return 400 with field-level detail from
  zod. Unexpected errors are logged with a correlation id and returned as opaque 500s.
