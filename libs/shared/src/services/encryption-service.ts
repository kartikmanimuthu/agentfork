import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../env';

function isValidBase64(str: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(str) && str.length % 4 === 0;
}

export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const keyHex = env.ENCRYPTION_KEY;
    if (!keyHex) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    }
    this.key = Buffer.from(keyHex, 'hex');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
  }

  decrypt(encrypted: string): string {
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format');
    }
    const [ivBase64, ciphertextBase64, authTagBase64] = parts;
    if (!isValidBase64(ivBase64) || !isValidBase64(ciphertextBase64) || !isValidBase64(authTagBase64)) {
      throw new Error('Invalid encrypted format');
    }
    const iv = Buffer.from(ivBase64, 'base64');
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
