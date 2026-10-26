import { describe, expect, it, vi } from 'vitest';
import { createTokenProvider, type IdentityApi } from '../src/auth';

function identity(tokens: (string | undefined)[]) {
  const queue = [...tokens];
  const api: IdentityApi = {
    getAuthToken: vi.fn(async () => ({ token: queue.shift() })),
    removeCachedAuthToken: vi.fn(async () => undefined),
  };
  return api;
}

describe('createTokenProvider', () => {
  it('returns the interactive token without removing anything', async () => {
    const api = identity(['t1']);
    expect(await createTokenProvider(api)()).toBe('t1');
    expect(api.getAuthToken).toHaveBeenCalledWith({ interactive: true });
    expect(api.removeCachedAuthToken).not.toHaveBeenCalled();
  });

  it('on refresh drops the cached token and fetches a new one', async () => {
    const api = identity(['stale', 'fresh']);
    expect(await createTokenProvider(api)(true)).toBe('fresh');
    expect(api.removeCachedAuthToken).toHaveBeenCalledWith({ token: 'stale' });
  });

  it('throws when Google gives no token', async () => {
    await expect(createTokenProvider(identity([undefined]))()).rejects.toThrow('No Google token');
  });

  it('throws when the refreshed token is missing', async () => {
    await expect(createTokenProvider(identity(['stale', undefined]))(true)).rejects.toThrow('No Google token');
  });
});
