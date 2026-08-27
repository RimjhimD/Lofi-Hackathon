#!/usr/bin/env bash
# Verify every recipe: run its tests, and compile every component.
#
# The compile check exists because it has already caught a real failure that the
# test suite could not see (Svelte kit, before this port) — a component with 17
# passing tests beside it that did not compile at all (`class:border-ink-300/70` —
# Svelte's class: directive cannot contain a `/`, and Tailwind's opacity modifier
# put one there). React has no equivalent directive syntax, but the same class of
# bug is still possible — unbalanced JSX tags, a stray `}` in JSX text, a bad
# attribute expression — and the compiler is what catches it, not the tests.
# Proven directly: a deliberately unclosed `<div>` fails `esbuild` with a real
# parse error and a non-zero exit; every real component in this tree compiles
# clean. See playbook notes for the exact repro if you need to re-check it.
#
# Tests prove the logic. Only the compiler proves the component renders.
#
# Run from anywhere:  bash src/recipes/verify.sh

set -uo pipefail
cd "$(dirname "$0")"

fail=0
printf '\nrecipes\n-------\n'

for dir in */; do
  name="${dir%/}"
  [ -f "$dir/README.md" ] || continue

  # --- tests ---
  tests=$(ls "$dir"*.test.mjs 2>/dev/null)
  if [ -n "$tests" ]; then
    out=$(cd "$dir" && node --test ./*.test.mjs 2>&1)
    pass=$(printf '%s' "$out" | grep -oP '^# pass \K\d+' | head -1)
    bad=$(printf '%s' "$out" | grep -oP '^# fail \K\d+' | head -1)
    if [ "${bad:-1}" -eq 0 ] 2>/dev/null; then
      printf '  \033[32mok\033[0m   %-16s %s tests\n' "$name" "${pass:-0}"
    else
      printf '  \033[31mFAIL\033[0m %-16s %s passed, %s failed\n' "$name" "${pass:-0}" "${bad:-?}"
      printf '%s\n' "$out" | grep -E '^not ok' | head -5 | sed 's/^/         /'
      fail=1
    fi
  else
    printf '  \033[33m--\033[0m   %-16s no tests\n' "$name"
  fi

  # --- components ---
  for f in "$dir"*.jsx; do
    [ -e "$f" ] || continue
    if err=$(npx --prefix ../.. esbuild "$f" \
        --loader:.jsx=jsx --jsx=automatic --bundle --format=esm \
        --external:react --external:react-dom --external:@supabase/supabase-js \
        --outfile=/dev/null 2>&1); then
      :
    else
      printf '  \033[31mFAIL\033[0m %-16s %s — %s\n' "$name" "$(basename "$f")" "$(printf '%s' "$err" | grep -m1 ERROR)"
      fail=1
    fi
  done
done

printf '\n'
if [ "$fail" -eq 0 ]; then
  printf '\033[32mall recipes verified\033[0m\n\n'
else
  printf '\033[31msome recipes are broken — fix before relying on them\033[0m\n\n'
fi
exit "$fail"
