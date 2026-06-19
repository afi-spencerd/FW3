# OpenAPI specifications

Two **separate** OpenAPI 3.1 documents live here. They describe different APIs in
opposite directions — don't conflate them.

## `compounder.openapi.json` — the Compounder Dosing-Tool API (ours)

The API **we expose** for the compounder dosing tool to consume (read the work-order
queue, BOMs, and available inventory; report pours and work-order status).

- **Source of truth:** `apps/api/src/compounder/compounder.openapi.ts`.
- **Served live:** `GET /compounder/openapi.json` (unauthenticated, so tool
  developers can fetch the contract directly from a running API).
- **Regenerate this file** after changing the spec:
  ```
  pnpm --filter @fw3/api openapi:export
  ```
  Do not hand-edit `compounder.openapi.json` — it is generated.

## `quickbooks-agent.openapi.json` — the FormulaWeb QuickBooks Agent (external)

The contract for the **external** local agent that we *call* to push items and
customers into QuickBooks Desktop. This is **not** our API — it's a third
service's contract, provided so our QB sync (`apps/api/src/qb/`) can be built
against it. Maintained by the agent/sync tool team; kept here for reference.
