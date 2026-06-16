import type { config as MssqlConfig } from "mssql";

/**
 * Parse a Prisma-style SQL Server URL into a node-mssql config object.
 * Prisma 7 reaches SQL Server through @prisma/adapter-mssql, which wants an
 * mssql config (or connection string) rather than the Prisma URL — so we parse
 * the single DATABASE_URL once and reuse it for the runtime client and scripts.
 *
 *   sqlserver://host:port;database=fw3;user=sa;password=...;encrypt=true;trustServerCertificate=true
 */
export function mssqlConfigFromUrl(url: string): MssqlConfig {
  const withoutScheme = url.replace(/^sqlserver:\/\//, "");
  const [hostPort, ...kvParts] = withoutScheme.split(";");
  const [host, port] = (hostPort ?? "").split(":");

  const kv = new Map<string, string>();
  for (const part of kvParts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    kv.set(part.slice(0, idx).trim().toLowerCase(), part.slice(idx + 1));
  }

  const user = kv.get("user");
  const password = kv.get("password");

  return {
    server: host || "localhost",
    port: port ? Number(port) : 1433,
    database: kv.get("database") ?? "fw3",
    user,
    password,
    options: {
      // Default to encrypted unless explicitly disabled.
      encrypt: kv.get("encrypt") !== "false",
      trustServerCertificate: kv.get("trustservercertificate") === "true",
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
  } satisfies MssqlConfig;
}
