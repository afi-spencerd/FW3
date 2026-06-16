import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer auto-loads .env. Load the repo-root .env so the CLI and the
// spawned schema-engine see DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  // Connection used by migrate/introspect (schema-engine). The runtime client
  // uses @prisma/adapter-mssql instead (see PrismaService).
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
