/**
 * Parse a redis:// URL into a plain connection-options object for BullMQ. We let
 * BullMQ create and own its own Redis connections (its recommended pattern, and
 * it blocks on the worker connection) rather than sharing our request-path
 * client — that also avoids coupling to BullMQ's bundled ioredis version.
 */
export interface BullRedisOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
}

export function redisConnectionOptions(url: string): BullRedisOptions {
  const u = new URL(url);
  const options: BullRedisOptions = {
    host: u.hostname || "localhost",
    port: u.port ? Number(u.port) : 6379,
    maxRetriesPerRequest: null,
  };
  if (u.username) options.username = decodeURIComponent(u.username);
  if (u.password) options.password = decodeURIComponent(u.password);
  if (u.pathname.length > 1) options.db = Number(u.pathname.slice(1));
  return options;
}
