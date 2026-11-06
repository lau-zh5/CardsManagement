const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

export function fromB64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function newDEK() {
  return globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
}

export async function exportDEK(dek) {
  return new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', dek));
}

export async function importDEK(raw) {
  return globalThis.crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
  );
}

export async function kekFromPassword(password, salt, iterations = 600000) {
  const base = await globalThis.crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function kekFromPRF(prfOutput, salt) {
  const ikm = await globalThis.crypto.subtle.importKey(
    'raw', prfOutput, 'HKDF', false, ['deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF', hash: 'SHA-256', salt,
      info: enc.encode('cardsapp-kek-v1')
    },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function wrapDEK(kek, dek) {
  const raw = await exportDEK(dek);
  const iv = randomBytes(12);
  const data = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { iv: toB64(iv), data: toB64(data) };
}

export async function unwrapDEK(kek, wrapped) {
  const raw = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(wrapped.iv) }, kek, fromB64(wrapped.data)
  );
  return importDEK(new Uint8Array(raw));
}

export async function encryptText(dek, text) {
  const iv = randomBytes(12);
  const data = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, dek, enc.encode(text)
  );
  return { iv: toB64(iv), data: toB64(data) };
}

export async function decryptText(dek, record) {
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(record.iv) }, dek, fromB64(record.data)
  );
  return dec.decode(plain);
}

const VERIFIER = 'cardsapp-vault-v1';

export async function makeVerifier(dek) {
  return encryptText(dek, VERIFIER);
}

export async function checkVerifier(dek, record) {
  try {
    return (await decryptText(dek, record)) === VERIFIER;
  } catch (_) {
    return false;
  }
}

export async function encryptBackup(payload, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await kekFromPassword(password, salt, 310000);
  const data = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload))
  );
  return { v: 1, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

export async function decryptBackup(blob, password) {
  if (!blob || blob.v !== 1) throw new Error('备份格式无法识别');
  const key = await kekFromPassword(password, fromB64(blob.salt), 310000);
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.data)
  );
  return JSON.parse(dec.decode(plain));
}
