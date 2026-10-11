// Central place for source-file configuration so application code never

import path from 'node:path'
import { fileURLToPath } from "node:url";

// hardcodes a path to the raw workbook (see data/README.md).




const APP_ROOT = path.dirname(fileURLToPath(import.meta.url))
const configuredPath = process.env.WOODEN_BAKERY_WORKBOOK_PATH ?? path.join(APP_ROOT, 'data/canonical.sqlite')

export const CANONICAL_DB_PATH = path.resolve(configuredPath);
