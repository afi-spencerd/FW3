import { Injectable, NotImplementedException } from "@nestjs/common";

/** Identity claims we need from the IdP, regardless of provider. */
export interface OidcClaims {
  sub: string;
  email: string;
  name: string;
}

/**
 * Clean boundary for the OIDC handshake. The dev-login path does not touch this;
 * the real Entra implementation (openid-client) drops in here later without the
 * rest of the app changing.
 */
export abstract class OidcProvider {
  abstract getAuthorizationUrl(state: string): Promise<string>;
  abstract handleCallback(code: string, state: string): Promise<OidcClaims>;
}

/**
 * Placeholder until Entra credentials are wired. Methods throw a clear 501 so
 * the boundary is real and callable, but no live OIDC happens yet.
 */
@Injectable()
export class StubOidcProvider extends OidcProvider {
  private fail(): never {
    throw new NotImplementedException(
      "OIDC is not configured yet. Use POST /auth/dev-login for local development, " +
        "or provide OIDC_* env vars and swap in the Entra provider.",
    );
  }

  getAuthorizationUrl(): Promise<string> {
    return Promise.resolve(this.fail());
  }

  handleCallback(): Promise<OidcClaims> {
    return Promise.resolve(this.fail());
  }
}
