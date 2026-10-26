import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthUrl,
  createTokenProvider,
  parseAuthRedirect,
  type StoredToken,
  type TokenStore,
  type WebAuthApi,
} from '../src/auth';

const REDIRECT = 'https://abc.chromiumapp.org/';
const redirectWith = (token: string, expires = 3599) =>
  `${REDIRECT}#access_token=${token}&token_type=Bearer&expires_in=${expires}&scope=x`;

function setup(responses: (string | Error)[], stored?: StoredToken, nowMs = 1_000_000) {
  const queue = [...responses];
  const calls: { interactive: boolean; url: string }[] = [];
  const api: WebAuthApi = {
    getRedirectURL: () => REDIRECT,
    launchWebAuthFlow: vi.fn(async ({ url, interactive }) => {
      calls.push({ url, interactive });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  let held = stored;
  const store: TokenStore = {
    get: async () => held,
    set: async (t) => {
      held = t;
    },
  };
  const provider = createTokenProvider({ api, store, clientId: 'cid', scope: 'scope', now: () => nowMs });
  return { provider, calls, api, held: () => held };
}

describe('buildAuthUrl', () => {
  it('requests an implicit-flow token for the redirect URL and scope', () => {
    const u = new URL(buildAuthUrl('cid', REDIRECT, 'https://www.googleapis.com/auth/calendar'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('response_type')).toBe('token');
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar');
  });
});

describe('parseAuthRedirect', () => {
  it('reads the token and lifetime from the URL fragment', () => {
    expect(parseAuthRedirect(redirectWith('tok', 3000))).toEqual({ token: 'tok', expiresInSec: 3000 });
  });

  it('throws on an error redirect or a missing token', () => {
    expect(() => parseAuthRedirect(`${REDIRECT}#error=access_denied`)).toThrow('Google sign-in failed');
    expect(() => parseAuthRedirect(REDIRECT)).toThrow('Google sign-in failed');
  });
});

describe('createTokenProvider', () => {
  it('reuses a stored token that is still valid, without any sign-in', async () => {
    const { provider, api } = setup([], { token: 'saved', expiresAt: 2_000_000 });
    expect(await provider()).toBe('saved');
    expect(api.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it('tries silently first, and stores the token with its expiry', async () => {
    const { provider, calls, held } = setup([redirectWith('t1', 3600)]);
    expect(await provider()).toBe('t1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.interactive).toBe(false);
    expect(held()).toEqual({ token: 't1', expiresAt: 1_000_000 + 3600 * 1000 });
  });

  it('falls back to an interactive window when the silent attempt fails', async () => {
    const { provider, calls } = setup([new Error('user interaction required'), redirectWith('t2')]);
    expect(await provider()).toBe('t2');
    expect(calls.map((c) => c.interactive)).toEqual([false, true]);
  });

  it('treats a token expiring within a minute as expired', async () => {
    const { provider } = setup([redirectWith('new')], { token: 'old', expiresAt: 1_000_000 + 30_000 });
    expect(await provider()).toBe('new');
  });

  it('on refresh discards the stored token even if it looks valid', async () => {
    const { provider } = setup([redirectWith('new')], { token: 'rejected', expiresAt: 9_000_000 });
    expect(await provider(true)).toBe('new');
  });

  it('shares one in-flight sign-in between concurrent callers', async () => {
    const { provider, api } = setup([redirectWith('one')]);
    const [a, b] = await Promise.all([provider(), provider()]);
    expect([a, b]).toEqual(['one', 'one']);
    expect(api.launchWebAuthFlow).toHaveBeenCalledTimes(1);
  });

  it('throws a generic error when the user cancels', async () => {
    const { provider } = setup([new Error('x'), new Error('The user did not approve access.')]);
    await expect(provider()).rejects.toThrow('Google sign-in failed');
  });
});
