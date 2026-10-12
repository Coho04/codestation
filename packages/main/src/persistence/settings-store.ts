import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AppSettings {
  readonly claudeBinaryPath: string | null;
  readonly notificationsEnabled: boolean;
  /** Directories the user picked that Claude Code has never seen. */
  readonly extraProjectPaths: readonly string[];
  /** When off, the app never contacts GitHub — not even in the background. */
  readonly updateChecksEnabled: boolean;
}

const DEFAULTS: AppSettings = {
  claudeBinaryPath: null,
  notificationsEnabled: true,
  extraProjectPaths: [],
  updateChecksEnabled: true,
};

export class SettingsStore {
  #cache: AppSettings = DEFAULTS;

  constructor(private readonly userDataDir: string) {}

  get current(): AppSettings {
    return this.#cache;
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(join(this.userDataDir, 'settings.json'), 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.#cache = {
        claudeBinaryPath: parsed.claudeBinaryPath ?? null,
        notificationsEnabled: parsed.notificationsEnabled ?? true,
        extraProjectPaths: Array.isArray(parsed.extraProjectPaths) ? parsed.extraProjectPaths : [],
        updateChecksEnabled: parsed.updateChecksEnabled ?? true,
      };
    } catch {
      this.#cache = DEFAULTS;
    }
    return this.#cache;
  }

  async patch(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.#cache = { ...this.#cache, ...patch };
    const path = join(this.userDataDir, 'settings.json');
    await writeFile(`${path}.tmp`, JSON.stringify(this.#cache, null, 2), 'utf8');
    await rename(`${path}.tmp`, path);
    return this.#cache;
  }
}
