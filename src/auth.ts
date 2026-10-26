import type { TokenProvider } from './sync/google';

/** The slice of `chrome.identity` we use, so the refresh logic is testable without Chrome. */
export interface IdentityApi {
  getAuthToken(details: { interactive: boolean }): Promise<{ token?: string }>;
  removeCachedAuthToken(details: { token: string }): Promise<void>;
}

export function createTokenProvider(identity: IdentityApi): TokenProvider {
  return async (refresh) => {
    let { token } = await identity.getAuthToken({ interactive: true });
    if (token && refresh) {
      // The cached token was rejected: drop it (survives service-worker restarts) and fetch a new one.
      await identity.removeCachedAuthToken({ token });
      ({ token } = await identity.getAuthToken({ interactive: true }));
    }
    if (!token) throw new Error('No Google token');
    return token;
  };
}
