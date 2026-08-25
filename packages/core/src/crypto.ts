import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function hashObject(value: unknown): string {
  return sha256(stableStringify(value));
}

export function encryptJson(value: unknown, masterKeyHex: string): string {
  const key = Buffer.from(masterKeyHex, 'hex');
  if (key.length !== 32) throw new Error('SALES_CONNECT_MASTER_KEY must be exactly 32 bytes / 64 hex chars');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]).toString('base64url');
}

export function decryptJson<T>(encrypted: string, masterKeyHex: string): T {
  const data = Buffer.from(encrypted, 'base64url');
  if (data[0] !== 1) throw new Error('Unsupported encrypted credential version');
  const key = Buffer.from(masterKeyHex, 'hex');
  if (key.length !== 32) throw new Error('SALES_CONNECT_MASTER_KEY must be exactly 32 bytes / 64 hex chars');
  const iv = data.subarray(1, 13);
  const tag = data.subarray(13, 29);
  const ciphertext = data.subarray(29);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as T;
}

export function signHmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
