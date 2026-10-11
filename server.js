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

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(APP_ROOT, 'public');
const PORT = Number(process.env.PORT) || 8080;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.otf': 'font/otf' };

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

function openDb() {
  if (!existsSync(CANONICAL_DB_PATH)) throw new Error(`Canonical database missing at ${dbPath}`);
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    const html = await readFile(path.join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }
  if (req.method === 'GET' && ['/styles.css', '/app.js'].includes(url.pathname)) {
    const file = path.join(PUBLIC, path.basename(url.pathname));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/logo.png') {
    res.writeHead(200, { 'Content-Type': types['.png'], 'Cache-Control': 'public, max-age=86400' });
    res.end(await readFile(path.join(PUBLIC, 'logo_new.png')));
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/fonts/')) {
    const filename =  path.basename(url.pathname);
    const file = path.join(PUBLIC, 'fonts', filename)
    if (!['Montserrat-Regular.otf', 'Montserrat-Bold.otf', 'Montserrat-Black.otf'].includes(filename)) return json(res, {error: "Not Found"}, 404);
    res.writeHead(200, { 'Content-Type': types['.otf'], 'Cache-Control': 'public, max-age=86400' });
    res.end(await readFile(file));
    return;
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
    if (req.method === 'GET' && url.pathname === '/health') return json(res, { status: 'ok' });
    json(res, { error: 'Not found' }, 404);
  } catch (error) {
    json(res, { error: error.message === 'Request too large' ? error.message : 'Unable to read the demo data or answer this request.' }, error.message === 'Request too large' ? 413 : 500);
  } finally {
    db?.close();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wooden Bakery demo POC listening on port ${PORT}`);
});
