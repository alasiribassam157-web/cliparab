"""Anonymous identity: no accounts, no passwords.

Each browser keeps a random secret key (>=32 URL-safe chars) and sends it as ``Authorization: Bearer <key>``
(or ``?access_token=<key>`` for media/SSE URLs). The server only stores a one-way hash of it as the user id, so projects
stay private to whoever holds the key. Losing the key (clearing browser storage) means losing access to those projects.
"""

from __future__ import annotations

import hashlib
import re

_KEY = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


def user_id_for_key(key: str | None) -> str | None:
    if not key or not _KEY.match(key):
        return None
    return "u_" + hashlib.sha256(key.encode()).hexdigest()[:32]
