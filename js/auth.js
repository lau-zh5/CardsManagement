import * as C from './crypto.js';
import * as DB from './db.js';

const IDLE_MS = 60000;

let dek = null;
let config = null;
let idleTimer = null;
const listeners = [];

export const session = {
  get dek() { return dek; },
  get unlocked() { return dek !== null; },
  get hasPasskey() { return !!config?.credentialId; },
  get config() { return config; }
};

export function onChange(fn) { listeners.push(fn); }
function notify() { listeners.forEach((fn) => { try { fn(); } catch (_) {} }); }

export async function loadConfig() {
  config = await DB.Vault.get();
  return config;
}

export function prfSupported() {
  return window.isSecureContext === true &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.get === 'function' &&
    typeof navigator.credentials?.create === 'function';
}

export function touch() {
  if (!dek) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => lock(), IDLE_MS);
}

export function lock() {
  if (!dek && !idleTimer) return;
  dek = null;
  clearTimeout(idleTimer);
  idleTimer = null;
  notify();
}

function setDek(key) {
  dek = key;
  touch();
  notify();
}

async function getPRFOutput(credentialIdB64, prfSaltB64) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: C.randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: C.fromB64(credentialIdB64) }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: C.fromB64(prfSaltB64) } } }
    }
  });
  if (!assertion) throw new Error('生物识别已取消');
  const ext = assertion.getClientExtensionResults();
  const first = ext?.prf?.results?.first;
  if (!first) throw new Error('此环境不支持生物识别加密解锁，请改用主密码');
  return new Uint8Array(first);
}

export async function createVault(password) {
  const cfg = {
    key: 'config',
    version: 1,
    kdf: { iterations: 600000 },
    salt: C.toB64(C.randomBytes(16)),
    createdAt: new Date().toISOString()
  };
  const key = await C.newDEK();
  const kek = await C.kekFromPassword(password, C.fromB64(cfg.salt), cfg.kdf.iterations);
  cfg.wrappedPassword = await C.wrapDEK(kek, key);
  cfg.verifier = await C.makeVerifier(key);
  await DB.Vault.put(cfg);
  config = cfg;
  setDek(key);
  return cfg;
}

export async function unlockWithPassword(password) {
  const cfg = config || await loadConfig();
  if (!cfg?.wrappedPassword) throw new Error('保险库尚未创建');
  const kek = await C.kekFromPassword(password, C.fromB64(cfg.salt), cfg.kdf.iterations);
  const key = await C.unwrapDEK(kek, cfg.wrappedPassword);
  if (!await C.checkVerifier(key, cfg.verifier)) throw new Error('主密码不正确');
  setDek(key);
  return true;
}

export async function verifyPassword(password) {
  const cfg = config || await loadConfig();
  if (!cfg?.wrappedPassword) return false;
  const kek = await C.kekFromPassword(password, C.fromB64(cfg.salt), cfg.kdf.iterations);
  const key = await C.unwrapDEK(kek, cfg.wrappedPassword);
  return C.checkVerifier(key, cfg.verifier);
}

export async function unlockWithPasskey() {
  const cfg = config || await loadConfig();
  if (!cfg?.credentialId) throw new Error('尚未启用生物识别');
  const prf = await getPRFOutput(cfg.credentialId, cfg.prfSalt);
  const kek = await C.kekFromPRF(prf, C.fromB64(cfg.hkdfSalt));
  const key = await C.unwrapDEK(kek, cfg.wrappedPasskey);
  if (!await C.checkVerifier(key, cfg.verifier)) throw new Error('生物识别验证失败');
  setDek(key);
  return true;
}

export async function reverifyWithPasskey() {
  const cfg = config || await loadConfig();
  if (!cfg?.credentialId) throw new Error('尚未启用生物识别');
  const prf = await getPRFOutput(cfg.credentialId, cfg.prfSalt);
  const kek = await C.kekFromPRF(prf, C.fromB64(cfg.hkdfSalt));
  const key = await C.unwrapDEK(kek, cfg.wrappedPasskey);
  return C.checkVerifier(key, cfg.verifier);
}

export async function registerPasskey() {
  if (!dek) throw new Error('请先解锁保险库');
  if (!prfSupported()) throw new Error('当前环境不支持 WebAuthn，需 HTTPS 与系统生物识别');

  const prfSalt = C.randomBytes(32);
  const hkdfSalt = C.randomBytes(16);

  const created = await navigator.credentials.create({
    publicKey: {
      challenge: C.randomBytes(32),
      rp: { name: '卡包' },
      user: { id: C.randomBytes(16), name: '本地卡包', displayName: '本地卡包' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required'
      },
      timeout: 60000,
      extensions: { prf: {} }
    }
  });
  if (!created) throw new Error('注册已取消');

  const credentialId = C.toB64(new Uint8Array(created.rawId));
  const prf = await getPRFOutput(credentialId, C.toB64(prfSalt));
  const kek = await C.kekFromPRF(prf, hkdfSalt);

  const next = { ...config };
  next.credentialId = credentialId;
  next.prfSalt = C.toB64(prfSalt);
  next.hkdfSalt = C.toB64(hkdfSalt);
  next.wrappedPasskey = await C.wrapDEK(kek, dek);
  await DB.Vault.put(next);
  config = next;
  notify();
  return true;
}

export async function removePasskey() {
  const next = { ...config };
  delete next.credentialId;
  delete next.prfSalt;
  delete next.hkdfSalt;
  delete next.wrappedPasskey;
  await DB.Vault.put(next);
  config = next;
  notify();
}

export async function changePassword(oldPassword, newPassword) {
  if (!await verifyPassword(oldPassword)) throw new Error('原密码不正确');
  const next = { ...config };
  next.salt = C.toB64(C.randomBytes(16));
  const kek = await C.kekFromPassword(newPassword, C.fromB64(next.salt), next.kdf.iterations);
  next.wrappedPassword = await C.wrapDEK(kek, dek);
  await DB.Vault.put(next);
  config = next;
}

export async function wipeAll() {
  await DB.wipe();
  config = null;
  lock();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) lock(); });
  window.addEventListener('pagehide', lock);
  ['click', 'keydown', 'touchstart'].forEach((evt) => {
    document.addEventListener(evt, touch, { passive: true });
  });
}
