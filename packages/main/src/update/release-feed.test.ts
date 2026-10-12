import { describe, expect, it } from 'vitest';
import { selectUpdate, toReleaseInfo, type GithubRelease } from './release-feed.js';

const release = (overrides: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: 'v1.2.0',
  name: 'CodeStation 1.2.0',
  body: 'Behebt den Index-Neustart.',
  draft: false,
  prerelease: false,
  published_at: '2026-10-12T08:00:00Z',
  html_url: 'https://github.com/owner/repo/releases/tag/v1.2.0',
  assets: [
    {
      name: 'CodeStation-1.2.0-arm64.dmg',
      browser_download_url: 'https://example.invalid/CodeStation-1.2.0-arm64.dmg',
    },
    {
      name: 'CodeStation-1.2.0-arm64-mac.zip',
      browser_download_url: 'https://example.invalid/CodeStation-1.2.0-arm64-mac.zip',
    },
  ],
  ...overrides,
});

const options = { currentVersion: '1.0.0', arch: 'arm64' };

describe('toReleaseInfo', () => {
  it('maps a well-formed release and strips the v prefix', () => {
    const info = toReleaseInfo(release(), options);
    expect(info).not.toBeNull();
    expect(info?.version).toBe('1.2.0');
    expect(info?.publishedAt).toBe(Date.parse('2026-10-12T08:00:00Z'));
    expect(info?.downloadUrl).toContain('arm64.dmg');
  });

  it('picks the dmg for the running architecture', () => {
    const info = toReleaseInfo(
      release({
        assets: [
          { name: 'CodeStation-1.2.0-x64.dmg', browser_download_url: 'https://example.invalid/x64' },
          { name: 'CodeStation-1.2.0-arm64.dmg', browser_download_url: 'https://example.invalid/arm' },
        ],
      }),
      options,
    );
    expect(info?.downloadUrl).toBe('https://example.invalid/arm');
  });

  it('falls back to the only dmg when no name carries the architecture', () => {
    const info = toReleaseInfo(
      release({
        assets: [{ name: 'CodeStation.dmg', browser_download_url: 'https://example.invalid/only' }],
      }),
      options,
    );
    expect(info?.downloadUrl).toBe('https://example.invalid/only');
  });

  it('offers no download rather than the wrong one when several are ambiguous', () => {
    const info = toReleaseInfo(
      release({
        assets: [
          { name: 'a.dmg', browser_download_url: 'https://example.invalid/a' },
          { name: 'b.dmg', browser_download_url: 'https://example.invalid/b' },
        ],
      }),
      options,
    );
    expect(info?.downloadUrl).toBeNull();
    // The release page still works as a destination.
    expect(info?.url).toContain('releases/tag');
  });

  it('skips drafts and prereleases', () => {
    expect(toReleaseInfo(release({ draft: true }), options)).toBeNull();
    expect(toReleaseInfo(release({ prerelease: true }), options)).toBeNull();
    expect(
      toReleaseInfo(release({ prerelease: true }), { ...options, allowPrerelease: true }),
    ).not.toBeNull();
  });

  it('skips entries the parser cannot trust instead of throwing', () => {
    expect(toReleaseInfo(release({ tag_name: 'nightly' }), options)).toBeNull();
    expect(toReleaseInfo(release({ tag_name: undefined }), options)).toBeNull();
    expect(toReleaseInfo(release({ html_url: 42 }), options)).toBeNull();
    expect(toReleaseInfo(release({ assets: 'nope' }), options)?.downloadUrl).toBeNull();
    expect(toReleaseInfo(release({ published_at: 'not a date' }), options)?.publishedAt).toBeNull();
  });
});

describe('selectUpdate', () => {
  it('returns null when nothing is newer than the running build', () => {
    expect(selectUpdate([release({ tag_name: 'v1.0.0' })], options)).toBeNull();
    expect(selectUpdate([], options)).toBeNull();
  });

  it('takes the highest version, not the most recently published', () => {
    // GitHub orders by creation date, so a 1.1.1 patch released after 1.2.0
    // would otherwise win and offer a downgrade.
    const picked = selectUpdate(
      [release({ tag_name: 'v1.1.1' }), release({ tag_name: 'v1.2.0' })],
      options,
    );
    expect(picked?.version).toBe('1.2.0');
  });

  it('ignores unusable entries while still finding the usable one', () => {
    const picked = selectUpdate(
      [release({ tag_name: 'nightly' }), release({ draft: true, tag_name: 'v9.9.9' }), release()],
      options,
    );
    expect(picked?.version).toBe('1.2.0');
  });
});
