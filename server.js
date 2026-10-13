#!/usr/bin/env node
// Standalone, single-page Wooden Bakery demo. Data and question answers come
// from the existing read-only semantic model; no external AI provider is used.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { CANONICAL_DB_PATH } from './config.js';
import { getOverviewAnalytics } from './lib/analytics.js';
import { parseFilters } from './lib/filters.js';
import { answerQuestion } from './lib/analyst.js';
import { verifyToken, createToken, checkCredentials, sessionCookie, clearCookie, COOKIE_NAME } from './lib/auth.js';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(APP_ROOT, 'public');
const PORT = Number(process.env.PORT) || 4173;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.otf': 'font/otf' };

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

function openDb() {
  if (!existsSync(CANONICAL_DB_PATH)) throw new Error(`Canonical database missing at ${CANONICAL_DB_PATH}`);
  const db = new DatabaseSync(CANONICAL_DB_PATH, { readOnly: true });
  db.exec('PRAGMA temp_store=MEMORY; PRAGMA cache_size=-100000; PRAGMA mmap_size=268435456');
  return db;
}

async function bodyJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12_000) throw new Error('Request too large');
  }
  return JSON.parse(raw || '{}');
}


function sendFile(res, filePath, contentType, cacheControl) {
  return readFile(filePath).then((content) => {
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
    res.end(content);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function isAuthenticated(req) {
  return Boolean(verifyToken(parseCookies(req)[COOKIE_NAME]));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Auth endpoints (never require a session).
  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const input = await bodyJson(req);
      const email = typeof input.email === 'string' ? input.email.trim() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (!checkCredentials(email, password)) {
        return json(res, { error: 'Incorrect email or password.' }, 401);
      }
      res.setHeader('Set-Cookie', sessionCookie(createToken(email)));
      return json(res, { ok: true });
    } catch (error) {
      return json(res, { error: 'Sign in failed. Please try again.' }, 400);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    res.setHeader('Set-Cookie', clearCookie());
    return json(res, { ok: true });
  }

  // Login page is always reachable; the app page requires a session.
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/login')) {
    if (isAuthenticated(req)) return sendFile(res, path.join(PUBLIC, 'index.html'), types['.html'], 'no-store');
    return sendFile(res, path.join(PUBLIC, 'login.html'), types['.html'], 'no-store');
  }

  // Public health check for platform uptime probes.
  if (req.method === 'GET' && url.pathname === '/health') return json(res, { status: 'ok' });

  // Static assets needed by both pages.
  if (req.method === 'GET' && ['/styles.css', '/app.js', '/login.css', '/login.js'].includes(url.pathname)) {
    const file = path.join(PUBLIC, path.basename(url.pathname));
    return sendFile(res, file, types[path.extname(file)], 'no-cache');
  }
  if (req.method === 'GET' && url.pathname === '/logo.png') {
    return sendFile(res, path.join(PUBLIC, 'logo.png'), types['.png'], 'public, max-age=86400');
  }
  if (req.method === 'GET' && url.pathname.startsWith('/fonts/')) {
    const filename = path.basename(url.pathname);
    if (!['Montserrat-Regular.otf', 'Montserrat-Bold.otf', 'Montserrat-Black.otf'].includes(filename)) return json(res, { error: 'Not found' }, 404);
    return sendFile(res, path.join(PUBLIC, 'fonts', filename), types['.otf'], 'public, max-age=86400');
  }

  // Everything below requires an authenticated session.
  if (!isAuthenticated(req)) {
    if (url.pathname.startsWith('/api/')) return json(res, { error: 'Unauthorized' }, 401);
    return json(res, { error: 'Not found' }, 404);
  }

  let db;
  try {
    if (req.method === 'GET' && url.pathname === '/api/overview') {
      db = openDb();
      json(res, getOverviewAnalytics(db, parseFilters(Object.fromEntries(url.searchParams))));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      const input = await bodyJson(req);
      const question = typeof input.question === 'string' ? input.question.trim().slice(0, 500) : '';
      if (!question) return json(res, { error: 'Enter a question to analyze.' }, 400);
      db = openDb();
      const answer = answerQuestion(db, question, parseFilters(input.filters ?? {}));
      json(res, answer);
      return;
    }
    json(res, { error: 'Not found' }, 404);
  } catch (error) {
    console.error('POC request failed', {
      path: url.pathname,
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });

    json(
      res,
      { error: 'Unable to read the demo data or answer this request.' },
      500,
    );
  } finally {
    db?.close();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wooden Bakery demo POC listening on port ${PORT}`);
});