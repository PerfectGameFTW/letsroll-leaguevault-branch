import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { encrypt, decrypt, isEncrypted } from '../../server/utils/crypto';
import { expectErrorLog } from '../helpers/expected-error-logs';

// Use a deterministic test key (64 hex chars = 32 bytes)
const TEST_KEY = 'a'.repeat(64);

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
  delete process.env.FIELD_ENCRYPTION_KEY;
});

describe('crypto utilities', () => {
  describe('encrypt / decrypt', () => {
    it('round-trips plaintext correctly', () => {
      const original = 'EAATexampleSquareAccessToken123';
      const ciphertext = encrypt(original);
      expect(decrypt(ciphertext)).toBe(original);
    });

    it('produces different ciphertext each call (random IV)', () => {
      const ct1 = encrypt('same-value');
      const ct2 = encrypt('same-value');
      expect(ct1).not.toBe(ct2);
      // But both decrypt to the same value
      expect(decrypt(ct1)).toBe('same-value');
      expect(decrypt(ct2)).toBe('same-value');
    });

    it('returns null for tampered ciphertext', () => {
      // decrypt() logs the auth-tag failure at [ERROR] on purpose.
      expectErrorLog(/\[Crypto\] Decryption failed/);
      const ct = encrypt('secret');
      const parts = ct.split(':');
      // Corrupt the ciphertext portion
      parts[2] = parts[2].slice(0, -2) + 'ff';
      expect(decrypt(parts.join(':'))).toBeNull();
    });

    it('returns null for malformed input', () => {
      expect(decrypt('not-encrypted')).toBeNull();
      expect(decrypt('')).toBeNull();
      expect(decrypt('a:b')).toBeNull();
    });

    it('handles empty string', () => {
      const ct = encrypt('');
      expect(decrypt(ct)).toBe('');
    });

    it('handles unicode characters', () => {
      const original = 'access_token_with_unicode_€£¥';
      expect(decrypt(encrypt(original))).toBe(original);
    });
  });

  describe('isEncrypted', () => {
    it('detects encrypted values', () => {
      const ct = encrypt('some-token');
      expect(isEncrypted(ct)).toBe(true);
    });

    it('returns false for plaintext tokens', () => {
      expect(isEncrypted('EAATexampleSquareAccessToken')).toBe(false);
      expect(isEncrypted('sq0atp-abc123')).toBe(false);
    });

    it('returns false for partial format matches', () => {
      expect(isEncrypted('a:b:c')).toBe(false); // parts too short
    });
  });
});
