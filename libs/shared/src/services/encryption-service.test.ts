process.env.ENCRYPTION_KEY = 'a'.repeat(64);

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { env } from '../env';
import { EncryptionService } from './encryption-service';

describe('EncryptionService', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalKey;
    }
  });

  describe('constructor', () => {
    it('throws if ENCRYPTION_KEY is missing', () => {
      const spy = vi.spyOn(env as any, 'ENCRYPTION_KEY', 'get').mockReturnValue(undefined);
      try {
        expect(() => new EncryptionService()).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
      } finally {
        spy.mockRestore();
      }
    });

    it('throws if ENCRYPTION_KEY is wrong length', () => {
      const spy = vi.spyOn(env as any, 'ENCRYPTION_KEY', 'get').mockReturnValue('short');
      try {
        expect(() => new EncryptionService()).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
      } finally {
        spy.mockRestore();
      }
    });

    it('throws if ENCRYPTION_KEY is not hex', () => {
      const spy = vi.spyOn(env as any, 'ENCRYPTION_KEY', 'get').mockReturnValue('x'.repeat(64));
      try {
        expect(() => new EncryptionService()).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('encrypt / decrypt', () => {
    let spy: ReturnType<typeof vi.spyOn>;

    beforeAll(() => {
      spy = vi.spyOn(env as any, 'ENCRYPTION_KEY', 'get').mockReturnValue('a'.repeat(64));
    });

    afterAll(() => {
      spy.mockRestore();
    });

    it('round-trip encrypt and decrypt works', () => {
      const service = new EncryptionService();
      const plaintext = 'hello world';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trip works for empty string', () => {
      const service = new EncryptionService();
      const plaintext = '';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trip works for unicode and emoji', () => {
      const service = new EncryptionService();
      const plaintext = 'Hello, 世界! 🌍🚀';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext for same plaintext', () => {
      const service = new EncryptionService();
      const plaintext = 'hello world';
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('throws on tampered ciphertext', () => {
      const service = new EncryptionService();
      const encrypted = service.encrypt('secret data');
      const parts = encrypted.split(':');
      // Tamper with the ciphertext segment
      parts[1] = Buffer.from('tampered').toString('base64');
      const tampered = parts.join(':');
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('throws on tampered auth tag', () => {
      const service = new EncryptionService();
      const encrypted = service.encrypt('secret data');
      const parts = encrypted.split(':');
      // Tamper with the auth tag segment
      parts[2] = Buffer.from('badtag1234567890').toString('base64');
      const tampered = parts.join(':');
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('throws on invalid format (not enough parts)', () => {
      const service = new EncryptionService();
      expect(() => service.decrypt('only-one-part')).toThrow();
    });

    it('throws on invalid base64 in encrypted payload', () => {
      const service = new EncryptionService();
      expect(() => service.decrypt('!!!bad:!!!base64:!!!data')).toThrow('Invalid encrypted format');
    });
  });
});
