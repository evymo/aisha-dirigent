#!/usr/bin/env python3
"""Strip documentation-only underscore keys from Keycloak JSON seeds.

Usage: sanitize-keycloak-seed.py INPUT OUTPUT [CLIENT_ID]
When CLIENT_ID is supplied, select that client from INPUT.clients first.
"""

import json
import sys


def sanitize(value):
    if isinstance(value, dict):
        return {
            key: sanitize(child)
            for key, child in value.items()
            if not key.startswith("_")
        }
    if isinstance(value, list):
        return [sanitize(child) for child in value]
    return value


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: sanitize-keycloak-seed.py INPUT OUTPUT [CLIENT_ID]")

    with open(sys.argv[1], encoding="utf-8") as source:
        payload = json.load(source)

    if len(sys.argv) == 4:
        client_id = sys.argv[3]
        payload = next(
            client for client in payload.get("clients", [])
            if client.get("clientId") == client_id
        )

    with open(sys.argv[2], "w", encoding="utf-8") as target:
        json.dump(sanitize(payload), target, separators=(",", ":"))


if __name__ == "__main__":
    main()
