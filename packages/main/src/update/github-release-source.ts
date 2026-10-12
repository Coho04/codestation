import { net } from 'electron';
import { APP_NAME, REPO_NAME, REPO_OWNER } from '@cs/shared';
import type { GithubRelease } from './release-feed.js';
import type { ReleaseSource } from './ports.js';

const ENDPOINT = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=20`;
const TIMEOUT_MS = 10_000;

/**
 * Reads the public releases list.
 *
 * `net.fetch` rather than the global one: it goes through Chromium's network
 * stack, so it picks up the system proxy and certificate store — on a corporate
 * machine the global fetch would simply fail here.
 *
 * Unauthenticated, which caps the check at 60 requests per hour per IP. At one
 * check every six hours that is not a constraint, and it keeps the app from
 * ever asking for a token.
 */
export class GithubReleaseSource implements ReleaseSource {
  constructor(private readonly version: string) {}

  async list(): Promise<readonly GithubRelease[]> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const response = await net.fetch(ENDPOINT, {
        signal: abort.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `${APP_NAME}/${this.version}`,
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub antwortete mit ${response.status}`);
      }
      const body: unknown = await response.json();
      return Array.isArray(body) ? (body as GithubRelease[]) : [];
    } finally {
      clearTimeout(timer);
    }
  }
}
