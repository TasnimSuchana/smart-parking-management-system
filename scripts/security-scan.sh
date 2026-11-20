#!/bin/sh
# Static checks that run without network access. Exits non-zero on findings.
cd "$(dirname "$0")/.."
fail=0
echo "== 1. committed env files (only .env.example allowed)"
found=$(find . -name ".env*" ! -name ".env.example" -not -path "*/node_modules/*" | head); [ -n "$found" ] && { echo "FOUND: $found"; fail=1; } || echo "ok"
echo "== 2. hard-coded secret patterns"
if grep -RInE "(AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY|mongodb(\+srv)?://[^$\"' ]+:[^$\"' @]+@|(secret|password|apikey|api_key)[\"']?\s*[:=]\s*[\"'][A-Za-z0-9+/=_-]{16,}[\"'])" --include=*.js --include=*.jsx --include=*.yml --include=*.json --include=*.sh --exclude-dir=node_modules --exclude-dir=tests . ; then fail=1; else echo "ok"; fi
echo "== 3. dangerous constructs in source"
if grep -RInE "(eval\(|new Function\(|dangerouslySetInnerHTML|innerHTML\s*=|child_process|localStorage|sessionStorage)" --include=*.js --include=*.jsx --exclude-dir=node_modules --exclude-dir=tests backend frontend/src; then fail=1; else echo "ok"; fi
echo "== 4. services/ports published to host"
grep -nE "^\s+ports:" docker-compose.yml
echo "== 5. every route file uses auth for non-public mutations (manual review list)"
grep -RnE "app\.(post|put|patch|delete)\(" backend/*/src/index.js | grep -vE "authenticate|internalOnly|validate|/login|/register|/refresh|/logout|/forgot-password|/reset-password|/quote|/scan" || echo "ok"
exit $fail
