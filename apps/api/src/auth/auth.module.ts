import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./guards/auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { OidcProvider, StubOidcProvider } from "./oidc/oidc.provider";

/**
 * Global so AuthGuard/PermissionsGuard and AuthService are injectable anywhere.
 * Swap StubOidcProvider for the Entra implementation when credentials land.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    PermissionsGuard,
    { provide: OidcProvider, useClass: StubOidcProvider },
  ],
  exports: [AuthService, AuthGuard, PermissionsGuard],
})
export class AuthModule {}
