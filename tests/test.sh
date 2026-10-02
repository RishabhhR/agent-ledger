#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
installer="$root/install.sh"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/agent-ledger-tests.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

project="$tmp/project"
mkdir -p "$project"
printf '%s\n' '# existing project instructions' > "$project/CLAUDE.md"

bash "$installer" "$project" > "$tmp/install.log"
grep -q 'append  CLAUDE.md' "$tmp/install.log"
for file in .ledger/PROTOCOL.md .ledger/LEDGER.md .ledger/roles/architect.md \
  .ledger/roles/builder.md .ledger/roles/reviewer.md .ledger/validate.sh \
  .ledger/.agent-ledger-version CLAUDE.md AGENTS.md GEMINI.md; do
  test -f "$project/$file"
done
grep -q '# existing project instructions' "$project/CLAUDE.md"
bash "$project/.ledger/validate.sh" "$project"

# A second run is idempotent and does not duplicate pointer blocks.
bash "$installer" "$project" > "$tmp/install-again.log"
grep -q 'keep    CLAUDE.md (pointer already there)' "$tmp/install-again.log"
[ "$(grep -Fc '<!-- agent-ledger:start -->' "$project/CLAUDE.md")" -eq 1 ]
[ "$(grep -Fc '<!-- agent-ledger:end -->' "$project/CLAUDE.md")" -eq 1 ]
bash "$installer" --check "$project"

# Existing project ledger content is preserved by an update.
printf '%s\n' '# project-owned ledger' > "$tmp/custom-ledger"
cp "$tmp/custom-ledger" "$project/.ledger/LEDGER.md"
bash "$installer" --update "$project" > "$tmp/update.log"
grep -q '# project-owned ledger' "$project/.ledger/LEDGER.md"
cp "$root/template/.ledger/LEDGER.md" "$project/.ledger/LEDGER.md"

# A partial pointer block is repaired without duplicating the managed block.
partial="$tmp/partial"
mkdir -p "$partial"
printf '%s\n%s\n' '<!-- agent-ledger:start -->' 'partial content' > "$partial/CLAUDE.md"
bash "$installer" "$partial" > "$tmp/partial.log"
[ "$(grep -Fc '<!-- agent-ledger:start -->' "$partial/CLAUDE.md")" -eq 1 ]
[ "$(grep -Fc '<!-- agent-ledger:end -->' "$partial/CLAUDE.md")" -eq 1 ]
grep -q 'partial content' "$partial/CLAUDE.md"
bash "$installer" --check "$partial"

# The validator catches duplicate IDs and merge-conflict markers.
bad="$tmp/bad"
cp -R "$project" "$bad"
awk '
  /^## Checkpoints$/ {
    print "## Tasks"
    print "### [TASK-001] status:open from:codex to:builder opened:2026-10-03"
    print "first"
    print "### [TASK-001] status:open from:codex to:builder opened:2026-10-03"
    print "second"
  }
  { print }
' "$bad/.ledger/LEDGER.md" > "$tmp/bad-ledger"
mv "$tmp/bad-ledger" "$bad/.ledger/LEDGER.md"
printf '%s\n' '<<<<<<< conflict' >> "$bad/.ledger/LEDGER.md"
if bash "$bad/.ledger/validate.sh" "$bad" > "$tmp/bad.out" 2>&1; then
  echo 'validator unexpectedly passed invalid ledger' >&2
  exit 1
fi
grep -q 'duplicates entry TASK-001' "$tmp/bad.out"
grep -q 'merge-conflict marker' "$tmp/bad.out"

echo 'All tests passed.'
