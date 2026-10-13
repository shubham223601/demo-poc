// Central place for source-file configuration so application code never
// hardcodes a path to the canonical database (see data/README.md).

import path from 'node:path'
import { fileURLToPath } from "node:url";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url))
const configuredPath = process.env.WOODEN_BAKERY_CANONICAL_DB_PATH
  ?? process.env.WOODEN_BAKERY_WORKBOOK_PATH
  ?? path.join(APP_ROOT, 'data/generated/canonical.sqlite')

export const CANONICAL_DB_PATH = path.resolve(configuredPath);

// Demo access control (single user). Override via env in real deployments.
export const AUTH_EMAIL = process.env.WOODEN_BAKERY_AUTH_EMAIL ?? 'woodenbakerdemo@gmail.com'
export const AUTH_PASSWORD = process.env.WOODEN_BAKERY_AUTH_PASSWORD ?? 'jkhalilagrawal'
export const SESSION_SECRET = process.env.WOODEN_BAKERY_SESSION_SECRET ?? 'wooden-bakery-demo-session-secret'
