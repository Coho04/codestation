import { describe, expect, it, vi } from 'vitest';
import type { UpdateMode, UpdateStatus } from '@cs/shared';
import { UpdateService } from './update-service.js';
import type { AutoUpdaterPort, ReleaseSource } from './ports.js';
import type { GithubRelease } from './release-feed.js';

const newer: GithubRelease = {
  tag_name: 'v2.0.0',
  name: 'CodeStation 2.0.0',
  body: 'Neu',
  draft: false,
  prerelease: false,
  published_at: '2026-10-12T08:00:00Z',
  html_url: 'https://example.invalid/releases/tag/v2.0.0',
  assets: [
    { name: 'CodeStation-2.0.0-arm64.dmg', browser_download_url: 'https://example.invalid/dmg' },
  ],
};

interface Harness {
  readonly service: UpdateService;
  readonly emitted: UpdateStatus[];
}

function make(options: {
  releases?: readonly GithubRelease[] | (() => Promise<readonly GithubRelease[]>);
  mode?: UpdateMode;
  currentVersion?: string;
} = {}): Harness {
  const list = options.releases ?? [];
  const source: ReleaseSource = {
    list: typeof list === 'function' ? list : () => Promise.resolve(list),
  };
  const emitted: UpdateStatus[] = [];
  const service = new UpdateService({
    currentVersion: options.currentVersion ?? '1.0.0',
    arch: 'arm64',
    mode: options.mode ?? 'manual',
    source,
    now: () => 1_000,
    emit: (status) => emitted.push(status),
  });
  return { service, emitted };
}

describe('UpdateService', () => {
  it('starts idle and reports the running version', () => {
    const { service } = make();
    expect(service.status).toMatchObject({
      currentVersion: '1.0.0',
      mode: 'manual',
      phase: { kind: 'idle' },
      lastCheckedAt: null,
    });
  });

  it('reports `current` when nothing newer is published', async () => {
    const { service } = make({ releases: [{ ...newer, tag_name: 'v0.9.0' }] });
    const status = await service.check();
    expect(status.phase).toEqual({ kind: 'current' });
    expect(status.lastCheckedAt).toBe(1_000);
  });

  it('reports `available` and emits the transition through checking', async () => {
    const { service, emitted } = make({ releases: [newer] });
    const status = await service.check();
    expect(status.phase).toMatchObject({ kind: 'available', release: { version: '2.0.0' } });
    expect(emitted.map((s) => s.phase.kind)).toEqual(['checking', 'available']);
  });

  it('turns a failing source into an error phase instead of rejecting', async () => {
    const { service } = make({
      releases: () => Promise.reject(new Error('offline')),
    });
    const status = await service.check();
    expect(status.phase).toEqual({ kind: 'error', message: 'offline' });
    // A failed check must not pretend it happened.
    expect(status.lastCheckedAt).toBeNull();
  });

  it('collapses concurrent checks into one request', async () => {
    const list = vi.fn(() => Promise.resolve([newer]));
    const { service } = make({ releases: list });
    await Promise.all([service.check(), service.check(), service.check()]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when the build has updates disabled', async () => {
    const list = vi.fn(() => Promise.resolve([newer]));
    const { service, emitted } = make({ releases: list, mode: 'disabled' });
    await service.check();
    expect(list).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });

  it('stays in manual mode until an auto-updater is attached', async () => {
    const { service } = make({ releases: [newer], mode: 'auto' });
    expect(service.status.mode).toBe('manual');
    service.attachAutoUpdater(stubUpdater());
    expect(service.status.mode).toBe('auto');
  });

  it('refuses to download without an auto-updater', async () => {
    const { service } = make({ releases: [newer], mode: 'manual' });
    await service.check();
    const status = await service.download();
    expect(status.phase.kind).toBe('available');
  });

  it('reports progress and ends in `ready`', async () => {
    const { service, emitted } = make({ releases: [newer], mode: 'auto' });
    service.attachAutoUpdater(stubUpdater([0, 55.4, 100]));
    await service.check();
    emitted.length = 0;

    const status = await service.download();
    expect(status.phase).toMatchObject({ kind: 'ready', release: { version: '2.0.0' } });
    const percents = emitted
      .map((s) => (s.phase.kind === 'downloading' ? s.phase.percent : null))
      .filter((p): p is number => p !== null);
    // 55.4 is rounded, not truncated or passed through.
    expect(percents).toEqual([0, 0, 55, 100]);
  });

  it('keeps a downloaded update when a later check runs', async () => {
    const { service } = make({ releases: [newer], mode: 'auto' });
    service.attachAutoUpdater(stubUpdater());
    await service.check();
    await service.download();

    const status = await service.check();
    expect(status.phase.kind).toBe('ready');
  });

  it('installs only from `ready`', async () => {
    const quitAndInstall = vi.fn();
    const { service } = make({ releases: [newer], mode: 'auto' });
    service.attachAutoUpdater({ ...stubUpdater(), quitAndInstall });

    service.install();
    expect(quitAndInstall).not.toHaveBeenCalled();

    await service.check();
    await service.download();
    service.install();
    expect(quitAndInstall).toHaveBeenCalledOnce();
  });

  it('drops a pending offer when the user switches checks off', async () => {
    const { service } = make({ releases: [newer] });
    await service.check();
    expect(service.status.phase.kind).toBe('available');

    const status = service.setChecksEnabled(false);
    expect(status.checksEnabled).toBe(false);
    expect(status.phase).toEqual({ kind: 'idle' });
  });

  it('surfaces a failed download as an error, not a silent no-op', async () => {
    const { service } = make({ releases: [newer], mode: 'auto' });
    service.attachAutoUpdater({
      downloadAndStage: () => Promise.reject(new Error('Signatur ungültig')),
      quitAndInstall: vi.fn(),
    });
    await service.check();
    const status = await service.download();
    expect(status.phase).toEqual({ kind: 'error', message: 'Signatur ungültig' });
  });
});

function stubUpdater(progress: readonly number[] = []): AutoUpdaterPort {
  return {
    downloadAndStage: async (onProgress) => {
      for (const value of progress) onProgress(value);
      await Promise.resolve();
    },
    quitAndInstall: vi.fn(),
  };
}
