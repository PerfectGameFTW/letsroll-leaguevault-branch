import { describe, expect, it } from 'vitest';
import { validateSetupSecret, MIN_SETUP_SECRET_LENGTH } from '../../server/config';

describe('validateSetupSecret', () => {
  it('accepts an undefined secret (endpoint will disable itself)', () => {
    expect(validateSetupSecret(undefined)).toEqual({ ok: true });
  });

  it('accepts an empty-string secret as "unset"', () => {
    expect(validateSetupSecret('')).toEqual({ ok: true });
  });

  it('rejects a short secret', () => {
    const result = validateSetupSecret('hunter2');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/at least 32 characters/);
      expect(result.reason).toMatch(/openssl rand -base64 48/);
    }
  });

  it('rejects a secret one character below the floor', () => {
    const value = 'a'.repeat(MIN_SETUP_SECRET_LENGTH - 1);
    // also avoids the all-same-char path: tweak last char to vary it
    const mostlyVaried = value.slice(0, -1) + 'b';
    const result = validateSetupSecret(mostlyVaried);
    expect(result.ok).toBe(false);
  });

  it('rejects an all-same-character secret even when long enough', () => {
    const value = 'a'.repeat(MIN_SETUP_SECRET_LENGTH + 16);
    const result = validateSetupSecret(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/single repeated character/);
    }
  });

  it('accepts a long, varied secret (representative openssl output)', () => {
    // 48-byte base64-ish string (64 chars).
    const value = 'kQv3vJm2pX9sR7wT0aB4cD6eF8gH1iJ2kL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF';
    expect(value.length).toBeGreaterThanOrEqual(MIN_SETUP_SECRET_LENGTH);
    expect(validateSetupSecret(value)).toEqual({ ok: true });
  });

  it('accepts a secret exactly at the minimum length', () => {
    const value = 'A'.repeat(MIN_SETUP_SECRET_LENGTH - 1) + 'b';
    expect(value.length).toBe(MIN_SETUP_SECRET_LENGTH);
    expect(validateSetupSecret(value)).toEqual({ ok: true });
  });
});
