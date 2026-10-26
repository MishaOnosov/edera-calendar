import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));

  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('targets the portal only', () => {
    expect(manifest.host_permissions).toContain('https://lk.ederaschool.com/*');
  });

  it('declares identity and storage permissions', () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(['identity', 'storage']));
  });
});
