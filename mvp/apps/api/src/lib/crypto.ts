import crypto from 'crypto';
import argon2 from 'argon2';
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';

// ─── Argon2id Configuration ───────────────────────────────────────────────────
// Parameters from spec: memory=65536, iterations=3, parallelism=4
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

// For refresh token and backup code storage — same Argon2id params
export async function hashSecret(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

export async function verifySecret(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

// ─── KMS Envelope Encryption ──────────────────────────────────────────────────
// Encrypts arbitrary data using AES-256-GCM with a KMS-generated data key.
// Storage format (base64-encoded parts joined by ':'):
//   encryptedDataKey:iv:authTag:ciphertext

let kmsClient: KMSClient | null = null;

function getKmsClient(): KMSClient {
  if (!kmsClient) {
    kmsClient = new KMSClient({ region: process.env['AWS_REGION'] ?? 'us-west-2' });
  }
  return kmsClient;
}

export async function encryptField(plaintext: string, kmsKeyId: string): Promise<string> {
  const client = getKmsClient();

  const { Plaintext: dataKey, CiphertextBlob: encryptedDataKey } = await client.send(
    new GenerateDataKeyCommand({ KeyId: kmsKeyId, KeySpec: 'AES_256' }),
  );

  if (!dataKey || !encryptedDataKey) {
    throw new Error('KMS data key generation failed');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(dataKey), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Zero out the plaintext data key from memory immediately after use
  Buffer.from(dataKey).fill(0);

  return [
    Buffer.from(encryptedDataKey).toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export async function decryptField(encrypted: string): Promise<string> {
  const parts = encrypted.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted field format');

  const [encryptedDataKeyB64, ivB64, authTagB64, ciphertextB64] = parts as [
    string, string, string, string,
  ];

  const client = getKmsClient();
  const { Plaintext: dataKey } = await client.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedDataKeyB64, 'base64'),
    }),
  );

  if (!dataKey) throw new Error('KMS decryption failed');

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(dataKey),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

  const plaintext =
    decipher.update(Buffer.from(ciphertextB64, 'base64')).toString('utf8') +
    decipher.final('utf8');

  Buffer.from(dataKey).fill(0);

  return plaintext;
}

// ─── Refresh Token Generation ─────────────────────────────────────────────────
// Returns { tokenFamily, tokenValue, fullToken }
// fullToken = `${tokenFamily}:${tokenValue}` — sent to client as httpOnly cookie
// tokenFamily is used as the Redis lookup key
// tokenValue is hashed with Argon2id and stored as the Redis value

export interface RefreshToken {
  tokenFamily: string;
  tokenValue: string;
  fullToken: string;
}

export function generateRefreshToken(): RefreshToken {
  const tokenFamily = crypto.randomUUID();
  const tokenValue = crypto.randomBytes(32).toString('base64url');
  return {
    tokenFamily,
    tokenValue,
    fullToken: `${tokenFamily}:${tokenValue}`,
  };
}

export function parseRefreshToken(fullToken: string): { tokenFamily: string; tokenValue: string } {
  const colonIndex = fullToken.indexOf(':');
  if (colonIndex === -1) throw new Error('Invalid refresh token format');
  return {
    tokenFamily: fullToken.slice(0, colonIndex),
    tokenValue: fullToken.slice(colonIndex + 1),
  };
}

// ─── One-Time Token JTI Tracking ─────────────────────────────────────────────
// Used for email verification and password reset tokens to prevent replay.
// The JTI is stored in Redis with a TTL matching the token expiry.

export function generateJti(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ─── Device Fingerprint ───────────────────────────────────────────────────────
// Simple fingerprint for new-device detection: HMAC-SHA256 of User-Agent + IP
export function computeDeviceFingerprint(
  userAgent: string,
  ip: string,
  hmacSecret: string,
): string {
  return crypto
    .createHmac('sha256', hmacSecret)
    .update(`${userAgent}|${ip}`)
    .digest('hex');
}

// ─── Backup Codes ─────────────────────────────────────────────────────────────
export function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashSecret(code)));
}

export async function verifyBackupCode(
  submittedCode: string,
  storedHashes: string[],
): Promise<number | null> {
  for (let i = 0; i < storedHashes.length; i++) {
    const hash = storedHashes[i];
    if (hash && (await verifySecret(hash, submittedCode.toUpperCase()))) {
      return i;
    }
  }
  return null;
}
