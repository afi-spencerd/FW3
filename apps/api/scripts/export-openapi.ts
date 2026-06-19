/**
 * Emit the compounder dosing-tool OpenAPI spec to openapi/compounder.openapi.json
 * from its source of truth (compounder.openapi.ts). Run `pnpm --filter @fw3/api
 * openapi:export` after changing the spec. The same document is served live at
 * GET /compounder/openapi.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compounderOpenApiDocument } from "../src/compounder/compounder.openapi";

const out = path.resolve(__dirname, "../../../openapi/compounder.openapi.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(compounderOpenApiDocument, null, 2)}\n`);
console.log(`Wrote ${out}`);
