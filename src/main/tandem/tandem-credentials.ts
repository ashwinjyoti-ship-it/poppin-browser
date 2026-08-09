import { DatabaseSync } from 'node:sqlite';

/**
 * Tandem API credentials live only in Poppin's privileged desktop layer, sealed
 * with OS-backed encryption (macOS Keychain via Electron `safeStorage`). They
 * are never handed to a renderer, never written into a page, and never included
 * in anything sent to an agent.
 */

export interface SecretProtector {
  available: () => boolean;
  encrypt: (text: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export interface TandemCredential {
  baseUrl: string;
  apiKey: string;
}

interface CredentialRow {
  base_url: string;
  api_key: Uint8Array;
}

export class TandemCredentialStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string, private readonly protector?: SecretProtector) {
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tandem_credential (
        id TEXT PRIMARY KEY CHECK (id = 'primary'),
        base_url TEXT NOT NULL,
        api_key BLOB NOT NULL
      ) STRICT;
    `);
  }

  /** True when a credential is stored, without decrypting it. */
  has(): boolean {
    const row = this.database.prepare("SELECT 1 AS present FROM tandem_credential WHERE id = 'primary'").get();
    return Boolean(row);
  }

  baseUrl(): string | null {
    const row = this.database.prepare("SELECT base_url FROM tandem_credential WHERE id = 'primary'").get() as { base_url?: string } | undefined;
    return row?.base_url ?? null;
  }

  save(credential: TandemCredential): void {
    if (!this.protector?.available()) {
      throw new Error('OS-backed encryption is unavailable, so the Tandem API key was not saved.');
    }
    const ciphertext = this.protector.encrypt(credential.apiKey);
    this.database.prepare(`
      INSERT INTO tandem_credential (id, base_url, api_key) VALUES ('primary', ?, ?)
      ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key
    `).run(credential.baseUrl, ciphertext);
  }

  load(): TandemCredential | null {
    const row = this.database.prepare("SELECT base_url, api_key FROM tandem_credential WHERE id = 'primary'").get() as unknown as CredentialRow | undefined;
    if (!row) return null;
    if (!this.protector?.available()) {
      throw new Error('OS-backed encryption is unavailable, so the stored Tandem API key cannot be read.');
    }
    return { baseUrl: row.base_url, apiKey: this.protector.decrypt(Buffer.from(row.api_key)) };
  }

  clear(): void {
    this.database.prepare("DELETE FROM tandem_credential WHERE id = 'primary'").run();
  }

  close(): void {
    this.database.close();
  }
}

/** Rejects anything that is not a plain http(s) origin Poppin can reach. */
export function normalizeTandemBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter the Tandem address, for example https://tandem.example.com.');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error('Tandem must be reachable over http or https.');
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('That Tandem address is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Tandem must be reachable over http or https.');
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}
