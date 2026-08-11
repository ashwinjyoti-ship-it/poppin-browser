import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const MAGIC = Buffer.from('POPPINC1', 'utf8');
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/**
 * Passphrase-sealed continuity packages. Portable across Macs; independent of
 * OS Keychain `safeStorage` used for Tandem/Memory on a single device.
 */
export function sealContinuityPayload(plaintextJson: string, passphrase: string): Buffer {
  const password = normalizePassphrase(passphrase);
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextJson, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
}

export function openContinuityPayload(sealed: Buffer, passphrase: string): string {
  if (sealed.length < MAGIC.length + SALT_LENGTH + IV_LENGTH + 16) {
    throw new Error('That file is not a Poppin continuity package.');
  }
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('That file is not a Poppin continuity package.');
  }
  const password = normalizePassphrase(passphrase);
  let offset = MAGIC.length;
  const salt = sealed.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iv = sealed.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const tag = sealed.subarray(offset, offset + 16);
  offset += 16;
  const ciphertext = sealed.subarray(offset);
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Wrong passphrase, or the package is damaged.');
  }
}

export function normalizePassphrase(passphrase: string): string {
  const trimmed = passphrase.trim();
  if (trimmed.length < 8) {
    throw new Error('Use a passphrase of at least 8 characters.');
  }
  return trimmed;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

/** Test helper: constant-time compare of two UTF-8 strings. */
export function safeEqualUtf8(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
