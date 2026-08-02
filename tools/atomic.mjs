/**
 * Atomic writes and provenance sidecars — the Node half of tools/atomic.py.
 *
 * Same contract, so a raw/ file is identical whichever fetcher produced it:
 * write to a temporary file in the same directory, fsync, rename. An
 * interrupted fetch leaves the previous file intact, never half of a new one.
 *
 * Fetch writes and never deletes. Build owns dist/ and may wipe it. Last
 * session build_index.py deleted files it had not created and Kauno m. sav.
 * was lost twice.
 */

import {
  writeFileSync, mkdirSync, renameSync, existsSync, readFileSync,
  openSync, fsyncSync, closeSync, unlinkSync, readdirSync, statSync,
} from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';

export const RAW = 'data/raw';

/** raw/<operator>/<area>/<unit>.json — one file per unit of fetch work. */
export function rawPath(operator, area, unit) {
  return join(RAW, operator, area, `${unit}.json`);
}

function metaPath(path) {
  return path.endsWith('.json') ? path.slice(0, -5) + '.meta.json'
                                : path + '.meta.json';
}

function atomicText(path, text) {
  const dir = dirname(path) || '.';
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${process.pid}-${basename(path)}`);
  try {
    writeFileSync(tmp, text, 'utf8');
    const fd = openSync(tmp, 'r+');
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmp, path);
  } catch (err) {
    if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* ignore */ } }
    throw err;
  }
}

/** Write JSON plus its .meta.json sidecar, both atomically. */
export function writeJson(path, payload, { source = null, request = null } = {}) {
  const text = JSON.stringify(payload, null, 1);
  atomicText(path, text);

  let count = null;
  if (payload && typeof payload === 'object') {
    for (const key of ['entries', 'addresses', 'containers', 'dates']) {
      if (payload[key] && typeof payload[key] === 'object') {
        count = Array.isArray(payload[key]) ? payload[key].length
                                            : Object.keys(payload[key]).length;
        break;
      }
    }
  }
  const meta = {
    fetched_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source, request,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(text, 'utf8'),
    count,
  };
  atomicText(metaPath(path), JSON.stringify(meta, null, 1));
  return meta;
}

/**
 * Remove stale .tmp-* files left by a process that died mid-write.
 *
 * The writer's own catch cannot run when the process is killed outright, so the
 * temp file survives. The data is still safe — the rename never happened — but
 * the temps would accumulate. Only files older than maxAgeMs are removed, so a
 * write in progress is never touched.
 */
export function sweepTemps(root = RAW, maxAgeMs = 3600_000) {
  let removed = 0;
  const walk = (dir) => {
    let items;
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = join(dir, it.name);
      if (it.isDirectory()) { walk(p); continue; }
      if (!it.name.startsWith('.tmp-')) continue;
      try {
        if (Date.now() - statSync(p).mtimeMs > maxAgeMs) { unlinkSync(p); removed++; }
      } catch { /* racing with another sweeper is fine */ }
    }
  };
  walk(root);
  return removed;
}

export function readMeta(path) {
  const p = metaPath(path);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** True if the file exists and its sidecar says it was fetched recently. */
export function isFresh(path, maxAgeDays) {
  const meta = readMeta(path);
  if (!meta?.fetched_at) return false;
  const age = (Date.now() - Date.parse(meta.fetched_at)) / 86400000;
  return Number.isFinite(age) && age <= maxAgeDays;
}

/** Re-hash a raw file and compare with its sidecar. -> {ok, reason} */
export function verify(path) {
  if (!existsSync(path)) return { ok: false, reason: 'missing' };
  const meta = readMeta(path);
  if (!meta) return { ok: false, reason: 'no sidecar' };
  const text = readFileSync(path, 'utf8');
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  if (meta.sha256 && sha !== meta.sha256) {
    return { ok: false, reason: 'sha256 mismatch' };
  }
  return { ok: true, reason: 'ok' };
}
