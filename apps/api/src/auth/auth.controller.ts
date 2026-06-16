import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { z } from "zod";
import type { AuthenticatedUser } from "@fw3/shared-types";
import type { Env } from "../config/env";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./guards/auth.guard";
import { OidcProvider } from "./oidc/oidc.provider";

const devLoginSchema = z.object({ tenant: z.string().min(1).default("demo") });

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly oidc: OidcProvider,
  ) {}

  /** Local development login. Disabled unless DEV_AUTH=true. */
  @Post("dev-login")
  async devLogin(
    @Body(new ZodValidationPipe(devLoginSchema)) body: { tenant: string },
    @Req() req: Request,
  ): Promise<AuthenticatedUser | null> {
    if (!this.config.get("DEV_AUTH", { infer: true })) {
      throw new ForbiddenException("Dev auth is disabled");
    }
    const { userId, tenantId } = await this.auth.devLogin(body.tenant);
    req.session.userId = userId;
    req.session.tenantId = tenantId;
    return this.auth.getAuthenticatedUser(tenantId, userId);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Post("logout")
  logout(@Req() req: Request): Promise<{ ok: true }> {
    return new Promise((resolve) => {
      req.session.destroy(() => resolve({ ok: true }));
    });
  }

  /**
   * OIDC entry point (Entra). Stubbed until credentials are wired — the boundary
   * is real; the StubOidcProvider throws a clear 501.
   */
  @Get("login")
  async login(): Promise<{ authorizationUrl: string }> {
    const authorizationUrl = await this.oidc.getAuthorizationUrl("state");
    return { authorizationUrl };
  }
}
