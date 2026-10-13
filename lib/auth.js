// Minimal single-user authentication for the Wooden Bakery demo.
// Credentials and the session secret live in config.js (overridable via env).
import crypto from 'node:crypto';
import { AUTH_EMAIL, AUTH_PASSWORD, SESSION_SECRET } from '../config.js';

export const COOKIE_NAME = 'wb_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12 hours
const USE_SECURE_COOKIE = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_PROJECT_ID ||
  process.env.WOODEN_BAKERY_COOKIE_SECURE === 'true'
);

const b64url = (input) => Buffer.from(input).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');

export function createToken(email) {
  const payload = b64url(JSON.stringify({ sub: String(email).toLowerCase(), exp: Date.now() + MAX_AGE_MS }));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function checkCredentials(email, password) {
  const okEmail = typeof email === 'string' && email.trim().toLowerCase() === AUTH_EMAIL.toLowerCase();
  const okPassword = typeof password === 'string' && password === AUTH_PASSWORD;
  return okEmail && okPassword;
}

function cookie(value, maxAge) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(value)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`];
  if (USE_SECURE_COOKIE) parts.push('Secure');
  return parts.join('; ');
}

export const sessionCookie = (token) => cookie(token, Math.floor(MAX_AGE_MS / 1000));
export const clearCookie = () => cookie('', 0);
