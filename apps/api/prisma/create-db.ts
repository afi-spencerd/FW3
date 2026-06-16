/**
 * Create the `fw3` database if it doesn't exist. Prisma's SQL Server connector
 * cannot create the database itself, so this runs first. Idempotent.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";
import mssql from "mssql";

loadEnv({ path: path.resolve(__dirname, "../../../.env") });

function parseDatabaseUrl(url: string): { config: mssql.config; database: string } {
  // sqlserver://host:port;database=fw3;user=sa;password=...;encrypt=true;trustServerCertificate=true
  const withoutScheme = url.replace(/^sqlserver:\/\//, "");
  const [hostPort, ...kvParts] = withoutScheme.split(";");
  const [host, port] = (hostPort ?? "").split(":");
  const kv = new Map<string, string>();
  for (const part of kvParts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    kv.set(part.slice(0, idx).toLowerCase(), part.slice(idx + 1));
  }
  const database = kv.get("database") ?? "fw3";
  return {
    database,
    config: {
      server: host || "localhost",
      port: port ? Number(port) : 1433,
      user: kv.get("user"),
      password: kv.get("password"),
      database: "master",
      options: {
        encrypt: kv.get("encrypt") === "true",
        trustServerCertificate: kv.get("trustservercertificate") === "true",
      },
    },
  };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { config, database } = parseDatabaseUrl(url);

  const pool = await mssql.connect(config);
  try {
    // CREATE DATABASE can't be parameterized; validate the name to a safe set.
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(database)) {
      throw new Error(`Unsafe database name: ${database}`);
    }
    await pool.request().query(
      `IF DB_ID('${database}') IS NULL CREATE DATABASE [${database}];`,
    );
    console.log(`Database "${database}" is ready.`);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
