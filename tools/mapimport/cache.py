"""The map importer's step cache: a slow step's result is kept and reused while its inputs are the same.

Each cached step is keyed by a hash of everything it reads (the arrays, the settings, and for the PDF its path,
size and modification time), so a change anywhere upstream runs it again; nothing is reused by mistake. Results
live in <map folder>/.cache/ (private, with the pack), one file per step; a new result replaces the old one.
`build.py --no-cache` ignores and rewrites them. docs/best-practices/map-importer.md section 4c.
"""
import hashlib
import json
import os
import pickle
import zlib

import numpy as np

DIR = None          # set by build.py: <map folder>/.cache, or None to compute everything
HITS, MISSES = [], []


def _feed(h, x):
    if isinstance(x, np.ndarray):
        h.update(str((x.dtype.str, x.shape)).encode())
        h.update(np.ascontiguousarray(x).tobytes())
    elif hasattr(x, "tobytes") and hasattr(x, "size") and hasattr(x, "mode"):   # a PIL image
        h.update(str((x.mode, x.size)).encode())
        h.update(x.tobytes())
    elif isinstance(x, (list, tuple)):
        h.update(b"[")
        for v in x:
            _feed(h, v)
        h.update(b"]")
    elif isinstance(x, dict):
        h.update(b"{")
        for k in sorted(x, key=str):
            h.update(str(k).encode())
            _feed(h, x[k])
        h.update(b"}")
    else:
        h.update(json.dumps(x, sort_keys=True, default=str).encode())


def key(*parts):
    h = hashlib.sha1()
    for p in parts:
        _feed(h, p)
    return h.hexdigest()[:20]


def file_id(path):
    """A file's identity for a key: its path, size and modification time (a PDF is too large to hash each run)."""
    st = os.stat(path)
    return [os.path.abspath(path), st.st_size, int(st.st_mtime)]


def memo(name, fn, *args, key_extra=None, **kwargs):
    """fn(*args, **kwargs), reused from the cache while args, kwargs and key_extra are unchanged."""
    if not DIR:
        return fn(*args, **kwargs)
    k = key(name, key_extra if key_extra is not None else args, kwargs)
    path = os.path.join(DIR, f"{name}.pkl")
    if os.path.exists(path):
        try:
            with open(path, "rb") as f:
                saved_k, value = pickle.loads(zlib.decompress(f.read()))
            if saved_k == k:
                HITS.append(name)
                return value
        except Exception:
            pass
    value = fn(*args, **kwargs)
    os.makedirs(DIR, exist_ok=True)
    with open(path + ".tmp", "wb") as f:   # compressed: masks shrink about a hundredfold, images about half
        f.write(zlib.compress(pickle.dumps((k, value), protocol=pickle.HIGHEST_PROTOCOL), 3))
    os.replace(path + ".tmp", path)
    MISSES.append(name)
    return value
