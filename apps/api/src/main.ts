import "reflect-metadata";
import "./auth/session.types";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { RedisStore } from "connect-redis";
import session from "express-session";
import helmet from "helmet";
import type IORedis from "ioredis";
import { AppModule } from "./app.module";
import type { Env } from "./config/env";
import { REDIS } from "./redis/redis.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  const config = app.get(ConfigService) as ConfigService<Env, true>;
  const redis = app.get<IORedis>(REDIS);

  if (config.get("NODE_ENV", { infer: true }) === "production") {
    // Behind Caddy's TLS: trust X-Forwarded-Proto so secure cookies are sent.
    app.set("trust proxy", 1);
  }

  app.use(helmet());
  app.enableCors({
    origin: config.get("WEB_ORIGIN", { infer: true }),
    credentials: true,
  });

  app.use(
    session({
      store: new RedisStore({ client: redis, prefix: "fw3:sess:" }),
      secret: config.get("SESSION_SECRET", { infer: true }),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.get("NODE_ENV", { infer: true }) === "production",
        maxAge: 1000 * 60 * 60 * 8, // 8h
      },
    }),
  );

  const port = config.get("API_PORT", { infer: true });
  await app.listen(port);
  new Logger("Bootstrap").log(`API listening on http://localhost:${port}`);
}

void bootstrap();
