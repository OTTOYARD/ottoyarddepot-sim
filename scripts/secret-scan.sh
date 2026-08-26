#!/usr/bin/env bash
# Secret scan — single source of truth, run by CI (.github/workflows/secret-scan.yml)
# and locally via pre-commit (.pre-commit-config.yaml). Zero network, zero deps
# beyond git + python3, so it gives the same answer everywhere.
#
# What it blocks, and why these rules and not "no JWT anywhere":
#   - provider API keys and access tokens: never legitimate in a repo;
#   - service_role Supabase JWTs: bypass RLS — never legitimate in a repo.
#     Every committed JWT-shaped literal gets its payload decoded and checked,
#     so a service key can't hide inside an otherwise-allowlisted file;
#   - JWT literals outside the explicit allowlist: the two allowlisted files
#     carry known publishable (anon-role) keys — .env feeds the Lovable build,
#     and src/lib/ottoTwin.ts is tracked cleanup debt. New JWT literals fail;
#   - newly tracked .env* files (only the existing .env and *.example pass).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0

# 1) Provider keys / tokens — zero tolerance in any tracked file.
if git grep -I -nE '(sk-ant-[A-Za-z0-9_-]{8}|sk-proj-[A-Za-z0-9_-]{8}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})' -- .; then
  echo 'FAIL: provider API key / access token committed (matches above).'
  fail=1
fi

# 2) Decode every committed JWT payload; any role=service_role fails, anywhere.
# (git grep exits 1 when nothing matches — rescue it so pipefail reflects python.)
if ! { git grep -I -hoE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}' -- . || true; } \
  | sort -u \
  | python3 -c '
import base64, json, sys
bad = 0
for tok in sys.stdin.read().split():
    try:
        seg = tok.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))
    except Exception:
        continue
    if payload.get("role") == "service_role":
        print("service_role JWT committed (ref=%r)" % payload.get("ref"))
        bad = 1
sys.exit(bad)
'; then
  echo 'FAIL: a service_role JWT is committed. Rotate it via the Supabase dashboard, then remove it.'
  fail=1
fi

# 3) JWT literals only in the allowlist (known publishable anon keys).
ALLOW=(':!.env' ':!src/lib/ottoTwin.ts')
if git grep -I -nE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}' -- . "${ALLOW[@]}"; then
  echo 'FAIL: JWT-shaped literal outside the allowlist (matches above). Use env config instead.'
  fail=1
fi

# 4) No new tracked env files.
extra=$(git ls-files | grep -iE '(^|/)\.env(\.[^/]+)?$' | grep -v -x '.env' | grep -vE '\.example$' || true)
if [ -n "$extra" ]; then
  echo "FAIL: newly tracked env file(s): $extra"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo 'secret-scan: FAILED'
  exit 1
fi
echo 'secret-scan: clean'
