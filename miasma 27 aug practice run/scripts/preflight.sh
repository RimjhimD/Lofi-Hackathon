#!/usr/bin/env bash
# Preflight — run before the first push and again before submitting.
#
# Two jobs:
#   1. Refuse to ship key material. A public hackathon repo with a live key in
#      it cannot be un-leaked; rotation is the only fix and there is no time.
#   2. Prove the production build actually builds. "Works in dev" has ended
#      more hackathons than any bug.
#
# Usage: npm run preflight

set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
note() { printf '  %s\n' "$1"; }
ok()   { printf '\033[32m  ok\033[0m   %s\n' "$1"; }
bad()  { printf '\033[31m  FAIL\033[0m %s\n' "$1"; fail=1; }

echo
echo "preflight"
echo "---------"

# --- 1. secrets ------------------------------------------------------------
# Search tracked files only when in a git repo; otherwise search the tree
# minus the usual noise.
if git rev-parse --git-dir >/dev/null 2>&1; then
  files=$(git ls-files)
else
  files=$(find . -type f \
    -not -path './node_modules/*' -not -path './dist/*' -not -path './.git/*')
fi

# Patterns are deliberately narrow to avoid crying wolf on placeholder text.
patterns=(
  'eyJ[A-Za-z0-9_-]\{20,\}\.[A-Za-z0-9_-]\{20,\}'   # JWT (Supabase keys are JWTs)
  'sk-[A-Za-z0-9]\{20,\}'                            # OpenAI-style secret key
  'AIza[0-9A-Za-z_-]\{35\}'                          # Google API key
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  # A Supabase service_role key is itself a JWT, so the eyJ pattern above
  # already catches it. Matching the bare string "service_role" only fires on
  # documentation that warns against it — a false positive that trains you to
  # ignore this script, which is worse than not running it.
)

hits=0
for p in "${patterns[@]}"; do
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in *.env.example|*preflight.sh|*.gitignore) continue ;; esac
    if grep -qsI "$p" "$f" 2>/dev/null; then
      bad "possible secret in $f"
      hits=1
    fi
  done <<< "$files"
done
[ "$hits" -eq 0 ] && ok "no key material in tracked files"

# A committed .env is the single most common way this goes wrong.
if git rev-parse --git-dir >/dev/null 2>&1 && git ls-files --error-unmatch .env >/dev/null 2>&1; then
  bad ".env is tracked by git — 'git rm --cached .env' now"
else
  ok ".env not tracked"
fi

# Binary credential screenshots slip past text greps entirely.
shots=$(printf '%s\n' "$files" | grep -iE '(key|secret|token|login|credential)[^/]*\.(png|jpe?g|webp)$' || true)
if [ -n "$shots" ]; then
  bad "credential-looking image files present:"
  printf '%s\n' "$shots" | sed 's/^/         /'
else
  ok "no credential screenshots"
fi

# --- 2. build --------------------------------------------------------------
echo
if npm run build >/tmp/preflight-build.log 2>&1; then
  size=$(du -sh dist 2>/dev/null | cut -f1)
  ok "production build succeeds (dist = ${size:-?})"
else
  bad "production build FAILED — last lines:"
  tail -n 12 /tmp/preflight-build.log | sed 's/^/         /'
fi

# --- 3. template branding --------------------------------------------------
echo
# Only what a judge can see: shipped source and the page head. This script and
# the docs mention the placeholder strings on purpose.
leftovers=$(grep -rlsI -e 'Rename me before you demo' -e 'Vite + Svelte' \
  src index.html 2>/dev/null || true)
if [ -n "$leftovers" ]; then
  note "warning: template branding still present in:"
  printf '%s\n' "$leftovers" | sed 's/^/         /'
  note "(fine while building — not fine at submission)"
else
  ok "no template branding left"
fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32mpreflight passed\033[0m\n\n'
else
  printf '\033[31mpreflight failed — fix the above before pushing\033[0m\n\n'
fi
exit "$fail"
