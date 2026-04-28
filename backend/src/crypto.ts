import crypto from 'crypto';
import fs from 'fs/promises';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV — recommended for GCM
const TAG_BYTES = 16;  // 128-bit auth tag
const HEADER_BYTES = IV_BYTES + TAG_BYTES; // 28 bytes prepended to every encrypted file

function getKey(): Buffer {
  const hex = process.env.FILE_ENCRYPT_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('FILE_ENCRYPT_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

// Encrypts a file in-place. On-disk format: [IV(12)] [AuthTag(16)] [Ciphertext]
export async function encryptFile(filePath: string): Promise<void> {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const plain = await fs.readFile(filePath);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  await fs.writeFile(filePath, Buffer.concat([iv, tag, ciphertext]));
}

// Reads an encrypted file from disk and returns the decrypted plaintext buffer.
export async function decryptFile(filePath: string): Promise<Buffer> {
  const data = await fs.readFile(filePath);
  if (data.length < HEADER_BYTES) {
    throw new Error(`File too small to be a valid encrypted file: ${filePath}`);
  }
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, HEADER_BYTES);
  const ciphertext = data.subarray(HEADER_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
