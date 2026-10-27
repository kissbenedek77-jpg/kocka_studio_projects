'use strict';
const crypto = require('node:crypto');

function normalizeUsername(value) {
  const username=String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._@-]{2,127}$/.test(username))
    throw new Error('A felhasználónév 3–128 karakter lehet: betű, szám, pont, kötőjel, aláhúzás vagy @.');
  return username;
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (typeof password !== 'string' || password.length < 16 || password.length > 1024)
    throw new Error('A helyi jelszó 16–1024 karakter lehet.');
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

function validHash(value) {
  const match = /^scrypt:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{86})$/.exec(String(value || ''));
  return match && Buffer.from(match[1], 'base64url').length === 16 &&
    Buffer.from(match[2], 'base64url').length === 64 ? match : null;
}

function verifyPassword(password, stored) {
  const match = validHash(stored);
  if (!match || typeof password !== 'string' || password.length > 1024) return false;
  const expected = Buffer.from(match[2], 'base64url');
  const actual = crypto.scryptSync(password, Buffer.from(match[1], 'base64url'), 64);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {hashPassword, validHash, verifyPassword, normalizeUsername};
