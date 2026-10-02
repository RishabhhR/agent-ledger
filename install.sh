#!/usr/bin/env bash
# Copies the ledger kit into a repo. Safe to re-run: it never overwrites a file
# that already exists, and it appends the pointer to an existing instruction
# file only once.
#
#   ./install.sh /path/to/your/repo
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
target="${1:-.}"
[ -d "$target" ] || { echo "Not a directory: $target" >&2; exit 1; }
target="$(cd "$target" && pwd)"
marker="<!-- agent-ledger:start -->"

mkdir -p "$target/.ledger/roles"
for f in PROTOCOL.md LEDGER.md roles/architect.md roles/builder.md roles/reviewer.md; do
  if [ -e "$target/.ledger/$f" ]; then
    echo "keep    .ledger/$f (already exists)"
  else
    cp "$here/template/.ledger/$f" "$target/.ledger/$f"
    echo "add     .ledger/$f"
  fi
done

for f in CLAUDE.md AGENTS.md GEMINI.md; do
  if [ ! -e "$target/$f" ]; then
    cp "$here/template/pointers/$f" "$target/$f"
    echo "add     $f"
  elif grep -qF "$marker" "$target/$f"; then
    echo "keep    $f (pointer already there)"
  else
    { printf '\n'; cat "$here/template/pointers/$f"; } >> "$target/$f"
    echo "append  $f (your existing content is untouched)"
  fi
done

cat <<MSG

Done. Next:
  1. git add .ledger CLAUDE.md AGENTS.md GEMINI.md && git commit -m "add agent ledger"
  2. Add a first task to .ledger/LEDGER.md (see the format at the top of that file).
  3. Open your agent(s) in the repo. They will read the pointer and the protocol.
MSG
