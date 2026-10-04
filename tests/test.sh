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

# Flags are accepted in any order, unknown flags are rejected, and a late
# --check never installs files into an empty target.
late_check="$tmp/late-check"
mkdir -p "$late_check"
if bash "$installer" "$late_check" --check > "$tmp/late-check.out" 2>&1; then
  echo 'late --check unexpectedly passed without an installation' >&2
  exit 1
fi
[ -z "$(find "$late_check" -mindepth 1 -print -prune)" ]
if bash "$installer" --not-a-real-option "$tmp/unknown" > "$tmp/unknown.out" 2>&1; then
  echo 'unknown option unexpectedly passed' >&2
  exit 1
fi
if bash "$installer" "$tmp/one" "$tmp/two" > "$tmp/extra.out" 2>&1; then
  echo 'extra positional argument unexpectedly passed' >&2
  exit 1
fi

# A second run is idempotent and does not duplicate pointer blocks.
bash "$installer" "$project" > "$tmp/install-again.log"
grep -q 'keep    CLAUDE.md (pointer already there)' "$tmp/install-again.log"
[ "$(grep -Fc '<!-- agent-ledger:start -->' "$project/CLAUDE.md")" -eq 1 ]
[ "$(grep -Fc '<!-- agent-ledger:end -->' "$project/CLAUDE.md")" -eq 1 ]
bash "$installer" --check "$project"

# The real-run example uses claimed:/closed: fields; ISO timestamps are valid.
example="$tmp/example"
cp -R "$project" "$example"
cp "$root/examples/real-run-ledger.md" "$example/.ledger/LEDGER.md"
bash "$example/.ledger/validate.sh" "$example"
sed 's/opened:2026-10-03/opened:2026-10-03T09:00Z/' \
  "$root/examples/real-run-ledger.md" > "$example/.ledger/LEDGER.md"
bash "$example/.ledger/validate.sh" "$example"

# Unused pointer files may be absent; every pointer that remains must be valid.
rm "$project/GEMINI.md"
bash "$installer" --check "$project"
no_pointer="$tmp/no-pointer"
cp -R "$project" "$no_pointer"
rm "$no_pointer/CLAUDE.md" "$no_pointer/AGENTS.md"
if bash "$installer" --check "$no_pointer" > "$tmp/no-pointer.out" 2>&1; then
  echo 'validation unexpectedly passed without any pointer file' >&2
  exit 1
fi
grep -q 'at least one of CLAUDE.md' "$tmp/no-pointer.out"

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

# Repair writes through a symlink instead of replacing it.
symlink_project="$tmp/symlink-project"
mkdir -p "$symlink_project"
printf '%s\n%s\n' '# shared instructions' '<!-- agent-ledger:start -->' > "$symlink_project/AGENTS.md"
ln -s AGENTS.md "$symlink_project/CLAUDE.md"
bash "$installer" "$symlink_project" > "$tmp/symlink.log"
[ -L "$symlink_project/CLAUDE.md" ]
[ "$(readlink "$symlink_project/CLAUDE.md")" = 'AGENTS.md' ]
[ "$(grep -Fc '<!-- agent-ledger:start -->' "$symlink_project/AGENTS.md")" -eq 1 ]
[ "$(grep -Fc '<!-- agent-ledger:end -->' "$symlink_project/AGENTS.md")" -eq 1 ]
bash "$installer" --check "$symlink_project"

# Pointer repair allocates temporary files under TMPDIR, not in the project.
mktemp_bin="$tmp/mktemp-bin"
mkdir -p "$mktemp_bin"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "$*" >> "$AGENT_LEDGER_MKTEMP_LOG"' 'exec /usr/bin/mktemp "$@"' > "$mktemp_bin/mktemp"
chmod +x "$mktemp_bin/mktemp"
repair_tmp="$tmp/repair-tmp"
mkdir -p "$repair_tmp"
repair_project="$tmp/tempdir-project"
mkdir -p "$repair_project"
printf '%s\n%s\n' '# project text' '<!-- agent-ledger:start -->' > "$repair_project/CLAUDE.md"
mktemp_log="$tmp/mktemp.log"
TMPDIR="$repair_tmp" AGENT_LEDGER_MKTEMP_LOG="$mktemp_log" PATH="$mktemp_bin:$PATH" \
  bash "$installer" "$repair_project" > "$tmp/tempdir.log"
grep -q "$repair_tmp/agent-ledger-pointer\." "$mktemp_log"
! grep -q "$repair_project/\.agent-ledger-pointer\." "$mktemp_log"
[ -z "$(find "$repair_project" -maxdepth 1 -name '.agent-ledger-pointer.*' -print -prune)" ]

# Duplicate complete blocks are removed rather than leaving stale orphan text.
duplicate="$tmp/duplicate"
mkdir -p "$duplicate"
{
  printf '%s\n' '# before'
  cat "$root/template/pointers/CLAUDE.md"
  cat "$root/template/pointers/CLAUDE.md"
  printf '%s\n' '# after'
} > "$duplicate/CLAUDE.md"
bash "$installer" "$duplicate" > "$tmp/duplicate.log"
[ "$(grep -Fc '<!-- agent-ledger:start -->' "$duplicate/CLAUDE.md")" -eq 1 ]
[ "$(grep -Fc '<!-- agent-ledger:end -->' "$duplicate/CLAUDE.md")" -eq 1 ]
[ "$(grep -Fc '## Multi-agent coordination' "$duplicate/CLAUDE.md")" -eq 1 ]
grep -q '# before' "$duplicate/CLAUDE.md"
grep -q '# after' "$duplicate/CLAUDE.md"
[ -z "$(find "$duplicate" -maxdepth 1 -name '.agent-ledger-pointer.*' -print -prune)" ]

# A Markdown setext underline with more than seven equals is not a conflict.
underline="$tmp/underline"
cp -R "$project" "$underline"
printf '%s\n' '========' >> "$underline/.ledger/LEDGER.md"
bash "$installer" --check "$underline"

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
