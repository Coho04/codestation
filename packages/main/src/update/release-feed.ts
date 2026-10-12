import type { ReleaseInfo } from '@cs/shared';
import { compareVersions, isNewer, parseVersion } from './version.js';

/**
 * The subset of the GitHub releases payload this app relies on.
 *
 * Deliberately narrow and all-optional: the response is third-party JSON, and
 * every field that is read here is read defensively. A release that does not
 * fit the shape is skipped, never thrown on — a malformed entry must not be
 * able to take out the update check.
 */
export interface GithubRelease {
  readonly tag_name?: unknown;
  readonly name?: unknown;
  readonly body?: unknown;
  readonly draft?: unknown;
  readonly prerelease?: unknown;
  readonly published_at?: unknown;
  readonly html_url?: unknown;
  readonly assets?: unknown;
}

export interface SelectOptions {
  /** Version of the running build, without a leading `v`. */
  readonly currentVersion: string;
  /** `arm64` or `x64`; picks the matching .dmg asset. */
  readonly arch: string;
  readonly allowPrerelease?: boolean;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

function assetUrl(release: GithubRelease, arch: string): string | null {
  if (!Array.isArray(release.assets)) return null;
  const dmgs: string[] = [];
  for (const entry of release.assets) {
    if (typeof entry !== 'object' || entry === null) continue;
    const asset = entry as { name?: unknown; browser_download_url?: unknown };
    const name = asString(asset.name);
    const url = asString(asset.browser_download_url);
    if (name === null || url === null || !name.endsWith('.dmg')) continue;
    if (name.includes(arch)) return url;
    dmgs.push(url);
  }
  // A release built before the artifact name carried the architecture still has
  // exactly one dmg; offering it beats offering nothing.
  return dmgs.length === 1 ? dmgs[0]! : null;
}

/** `null` when the entry is not a usable release for this build. */
export function toReleaseInfo(
  release: GithubRelease,
  options: SelectOptions,
): ReleaseInfo | null {
  if (release.draft === true) return null;
  if (release.prerelease === true && options.allowPrerelease !== true) return null;

  const tag = asString(release.tag_name);
  const url = asString(release.html_url);
  if (tag === null || url === null) return null;
  if (parseVersion(tag) === null) return null;

  const publishedAt = asString(release.published_at);
  const parsedDate = publishedAt === null ? Number.NaN : Date.parse(publishedAt);

  return {
    version: tag.replace(/^v/, ''),
    name: asString(release.name),
    notes: asString(release.body),
    publishedAt: Number.isNaN(parsedDate) ? null : parsedDate,
    url,
    downloadUrl: assetUrl(release, options.arch),
  };
}

/**
 * The newest release that is newer than what is running, or `null`.
 *
 * Takes the highest version rather than the first entry: GitHub orders releases
 * by creation date, so a patch backported to an older line after a newer
 * release would otherwise win.
 */
export function selectUpdate(
  releases: readonly GithubRelease[],
  options: SelectOptions,
): ReleaseInfo | null {
  let best: ReleaseInfo | null = null;
  for (const entry of releases) {
    const info = toReleaseInfo(entry, options);
    if (info === null) continue;
    if (!isNewer(info.version, options.currentVersion)) continue;
    if (best === null) {
      best = info;
      continue;
    }
    const a = parseVersion(info.version);
    const b = parseVersion(best.version);
    if (a !== null && b !== null && compareVersions(a, b) > 0) best = info;
  }
  return best;
}
