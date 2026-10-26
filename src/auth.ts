import type { TokenProvider } from './sync/google';

export class AuthError extends Error {
  constructor() {
    super('Google sign-in failed');
    this.name = 'AuthError';
  }
}

/** The slice of `chrome.identity` we use, so the sign-in logic is testable without Chrome. */
export interface WebAuthApi {
  getRedirectURL(): string;
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
}

export interface StoredToken {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface TokenStore {
  get(): Promise<StoredToken | undefined>;
  set(token: StoredToken | undefined): Promise<void>;
}

const EXPIRY_MARGIN_MS = 60_000;

export function buildAuthUrl(clientId: string, redirectUri: string, scope: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Google redirects to `<redirect>#access_token=...&expires_in=...` (implicit flow). */
export function parseAuthRedirect(redirectUrl: string): { token: string; expiresInSec: number } {
  const fragment = new URL(redirectUrl).hash.slice(1);
  const params = new URLSearchParams(fragment);
  const token = params.get('access_token');
  if (!token) throw new AuthError();
  return { token, expiresInSec: Number(params.get('expires_in')) || 3600 };
}

export interface TokenProviderDeps {
  api: WebAuthApi;
  store: TokenStore;
  clientId: string;
  scope: string;
  now: () => number;
}

/**
 * Works in every Chromium browser (unlike `chrome.identity.getAuthToken`, which needs Google Chrome).
 * Tries a silent sign-in first and only opens a Google window when consent is needed.
 */
export function createTokenProvider(deps: TokenProviderDeps): TokenProvider {
  let inflight: Promise<string> | undefined;

  async function signIn(): Promise<string> {
    const url = buildAuthUrl(deps.clientId, deps.api.getRedirectURL(), deps.scope);
    let redirect: string | undefined;
    try {
      redirect = await deps.api.launchWebAuthFlow({ url, interactive: false });
    } catch {
      try {
        redirect = await deps.api.launchWebAuthFlow({ url, interactive: true });
      } catch {
        throw new AuthError();
      }
    }
    if (!redirect) throw new AuthError();
    const { token, expiresInSec } = parseAuthRedirect(redirect);
    await deps.store.set({ token, expiresAt: deps.now() + expiresInSec * 1000 });
    return token;
  }

  return async (refresh) => {
    if (!refresh) {
      const saved = await deps.store.get();
      if (saved && saved.expiresAt - EXPIRY_MARGIN_MS > deps.now()) return saved.token;
    }
    inflight ??= signIn().finally(() => {
      inflight = undefined;
    });
    return inflight;
  };
}
