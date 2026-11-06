import assert from 'node:assert/strict';
import * as C from '../js/crypto.js';
import { CARD_TYPES, getType, remindFields } from '../js/templates.js';
import { nextOccurrence } from '../js/utils.js';

const password = 'correct-horse-battery-staple';
const salt = C.randomBytes(16);

const dek = await C.newDEK();
const kek = await C.kekFromPassword(password, salt, 10000);
const wrapped = await C.wrapDEK(kek, dek);
const restored = await C.unwrapDEK(kek, wrapped);
const record = await C.encryptText(restored, '6222021234567890123');
assert.equal(await C.decryptText(restored, record), '6222021234567890123', 'AES-GCM 往返');
console.log('[ok] 主密码派生 KEK → 包裹 DEK → 卡号加解密');

const verifier = await C.makeVerifier(dek);
assert.equal(await C.checkVerifier(dek, verifier), true, '验证串');
const wrongKek = await C.kekFromPassword('wrong-password', salt, 10000);
await assert.rejects(() => C.unwrapDEK(wrongKek, wrapped), '错误密码必须失败');
assert.equal(await C.checkVerifier(restored, verifier), true, '解包后的 DEK 应等价');
console.log('[ok] 验证串与错误密码拒绝');

const prfOutput = C.randomBytes(32);
const prfKek = await C.kekFromPRF(prfOutput, salt);
const wrappedPRF = await C.wrapDEK(prfKek, dek);
const restoredPRF = await C.unwrapDEK(prfKek, wrappedPRF);
assert.equal(await C.decryptText(restoredPRF, record), '6222021234567890123', 'PRF 路径解密');
assert.equal(await C.checkVerifier(restoredPRF, verifier), true, '两种解锁路径得到同一 DEK');
console.log('[ok] WebAuthn PRF 派生 KEK 与密码路径共用同一 DEK');

const payload = { app: 'cardsapp', cards: [{ id: 'x' }], secrets: [{ value: '6222021234567890123' }] };
const blob = await C.encryptBackup(payload, 'backup-pass');
assert.equal((await C.decryptBackup(blob, 'backup-pass')).cards[0].id, 'x');
await assert.rejects(() => C.decryptBackup(blob, 'wrong-pass'), '错误备份密码必须失败');
console.log('[ok] 加密备份导出 / 导入往返');

assert.equal(CARD_TYPES.length, 8, '8 种卡类型');
assert.ok(getType('credit').fields.some((f) => f.sensitive), '信用卡含加密字段');
const expiry = remindFields('credit').find((f) => f.key === 'expiry');
assert.equal(nextOccurrence(expiry, '2030-12'), '2030-12-31');
const dueDay = remindFields('credit').find((f) => f.key === 'dueDay');
assert.match(nextOccurrence(dueDay, '23'), /^\d{4}-\d{2}-\d{2}$/);
console.log('[ok] 类型模板与提醒日期计算');

console.log('ALL OK');
