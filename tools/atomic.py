#!/usr/bin/env python3
"""Atomic writes and provenance sidecars for the fetch stage.

Two rules the pipeline exists to enforce, both learned the hard way:

**A step may only delete what it created.** Fetch writes into `raw/` and never
deletes; build owns `dist/` entirely and may wipe it at any time. Last session
`build_index.py` deleted files it had not created, and `Kauno m. sav.` was lost
twice — once so completely that the next run could not even list it as pending.

**A missing new file is not a deleted old one.** If a unit fails, the previous
file stays and the build uses it. That is only safe if writes are atomic: a
half-written file is indistinguishable from a complete one to every later step.

    from atomic import write_json, raw_path, is_fresh

    write_json(raw_path("ekonovus", "kauno-r-sav", "juragiu-k"), payload,
               source="ekonovus", request={"locality": "Juragių k."})
"""

import hashlib
import io
import json
import os
import tempfile
import time

RAW = "data/raw"
DIST = "dist"


def raw_path(operator, area, unit):
    """raw/<operator>/<area>/<unit>.json — one file per unit of fetch work."""
    return os.path.join(RAW, operator, area, unit + ".json")


def write_json(path, payload, *, source=None, request=None):
    """Write JSON, then its .meta.json sidecar, both atomically.

    Writes to a temporary file in the same directory, flushes, fsyncs, then
    renames. os.replace is atomic on both POSIX and Windows, so an interrupted
    run leaves the previous file completely intact rather than half of a new
    one. The sidecar is written after the data, so a sidecar always describes a
    file that is fully on disk.
    """
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    _atomic_text(path, text)

    count = None
    if isinstance(payload, dict):
        for key in ("entries", "addresses", "containers", "dates"):
            if isinstance(payload.get(key), (list, dict)):
                count = len(payload[key])
                break
    meta = {
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": source,
        "request": request,
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "bytes": len(text.encode("utf-8")),
        "count": count,
    }
    _atomic_text(_meta_path(path),
                 json.dumps(meta, ensure_ascii=False, indent=1))
    return meta


def _meta_path(path):
    return path[:-5] + ".meta.json" if path.endswith(".json") else path + ".meta.json"


def sweep_temps(root=RAW, max_age_seconds=3600):
    """Remove stale .tmp-* files left by a process that died mid-write.

    The writer's own `finally` cannot run when the process is killed outright
    (verified: SIGTERM during the write leaves the temp file behind). The data
    is still safe — the rename never happened, so the previous file is intact —
    but the temp files would accumulate. Only files older than max_age_seconds
    are removed, so a concurrent write in progress is never touched.

    Returns the number removed.
    """
    removed = 0
    now = time.time()
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if not name.startswith(".tmp-"):
                continue
            p = os.path.join(dirpath, name)
            try:
                if now - os.path.getmtime(p) > max_age_seconds:
                    os.remove(p)
                    removed += 1
            except OSError:
                pass          # racing with another sweeper is fine
    return removed


def _atomic_text(path, text):
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-",
                               suffix=os.path.basename(path))
    try:
        # Windows defaults to cp1252 and Lithuanian diacritics crash the write.
        with io.open(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
        tmp = None
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)


def read_meta(path):
    p = _meta_path(path)
    if not os.path.exists(p):
        return None
    try:
        return json.load(io.open(p, encoding="utf-8"))
    except (ValueError, OSError):
        return None


def is_fresh(path, max_age_days):
    """True if the file exists and its sidecar says it was fetched recently.

    Used by the cheap pre-check: an unchanged month should cost seconds, not a
    full re-fetch.
    """
    meta = read_meta(path)
    if not meta or not meta.get("fetched_at"):
        return False
    try:
        t = time.strptime(meta["fetched_at"], "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return False
    age = (time.time() - time.mktime(t) + time.timezone) / 86400.0
    return age <= max_age_days


def verify(path):
    """Re-hash a raw file and compare with its sidecar.

    Detects truncation and half-written files that predate atomic writes.
    Returns (ok, reason).
    """
    if not os.path.exists(path):
        return False, "missing"
    meta = read_meta(path)
    if not meta:
        return False, "no sidecar"
    text = io.open(path, encoding="utf-8").read()
    if meta.get("sha256") and \
            hashlib.sha256(text.encode("utf-8")).hexdigest() != meta["sha256"]:
        return False, "sha256 mismatch"
    return True, "ok"
