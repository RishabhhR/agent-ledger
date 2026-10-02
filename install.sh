#!/usr/bin/env bash
# Install, inspect, or update the agent-ledger kit in a repository.
# Existing project files are never overwritten.
#
#   ./install.sh /path/to/your/repo
#   ./install.sh --check /path/to/your/repo
#   ./install.sh --diff /path/to/your/repo
#   ./install.sh --update /path/to/your/repo
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
mode="install"

usage() {
  cat <<'MSG'
Usage: ./install.sh [--check|--diff|--update] [REPO]

  install (default)  Add missing kit files and repair malformed pointers.
  --check            Validate an installed kit without changing files.
  --diff             Show differences from the kit templates.
  --update           Add newly introduced kit files and repair pointers.

Existing project files are not overwritten. Use --diff before deciding
whether a customized existing file should be updated manually.
MSG
}

case "${1:-}" in
  --check|--diff|--update)
    mode="${1#--}"
    shift
    ;;
  --help|-h)
    usage
    exit 0
    ;;
esac

target="${1:-.}"
[ -d "$target" ] || { echo "Not a directory: $target" >&2; exit 1; }
target="$(cd "$target" && pwd)"
version="$(tr -d '\r\n' < "$here/VERSION")"
marker="<!-- agent-ledger:start -->"
end_marker="<!-- agent-ledger:end -->"

if [ "$mode" = "check" ]; then
  if [ -f "$target/.ledger/.agent-ledger-version" ]; then
    installed_version="$(tr -d '\r\n' < "$target/.ledger/.agent-ledger-version")"
    if [ "$installed_version" != "$version" ]; then
      echo "WARNING: installed kit version is $installed_version; current kit is $version. Run --diff before deciding whether to update." >&2
    fi
  fi
  if [ -x "$target/.ledger/validate.sh" ]; then
    exec "$target/.ledger/validate.sh" "$target"
  elif [ -f "$target/.ledger/validate.sh" ]; then
    exec bash "$target/.ledger/validate.sh" "$target"
  else
    echo "ERROR: no installed validator at $target/.ledger/validate.sh" >&2
    exit 1
  fi
fi

extract_pointer_block() {
  awk -v start="$marker" -v end="$end_marker" '
    $0 == start { in_block=1 }
    in_block { print }
    $0 == end { in_block=0 }
  ' "$1"
}

show_diff() {
  local file template tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/agent-ledger-diff.XXXXXX")"

  for file in PROTOCOL.md roles/architect.md roles/builder.md roles/reviewer.md validate.sh; do
    template="$here/template/.ledger/$file"
    if [ -f "$target/.ledger/$file" ]; then
      diff -u "$target/.ledger/$file" "$template" || true
    else
      echo "Only in kit: .ledger/$file"
    fi
  done

  for file in CLAUDE.md AGENTS.md GEMINI.md; do
    if [ ! -f "$target/$file" ]; then
      echo "Only in kit: $file"
      continue
    fi
    extract_pointer_block "$target/$file" > "$tmp/$file"
    if [ ! -s "$tmp/$file" ]; then
      echo "No agent-ledger block in $file"
    else
      diff -u "$tmp/$file" "$here/template/pointers/$file" || true
    fi
  done

  if [ -f "$target/.ledger/.agent-ledger-version" ]; then
    installed_version="$(tr -d '\r\n' < "$target/.ledger/.agent-ledger-version")"
    if [ "$installed_version" != "$version" ]; then
      echo "Version differs: installed=$installed_version kit=$version"
    fi
  else
    echo "Only in kit: .ledger/.agent-ledger-version"
  fi

  rm -rf "$tmp"
}

if [ "$mode" = "diff" ]; then
  show_diff
  exit 0
fi

mkdir -p "$target/.ledger/roles"
for f in PROTOCOL.md LEDGER.md roles/architect.md roles/builder.md roles/reviewer.md validate.sh; do
  if [ -e "$target/.ledger/$f" ]; then
    echo "keep    .ledger/$f (already exists)"
  else
    cp "$here/template/.ledger/$f" "$target/.ledger/$f"
    chmod +x "$target/.ledger/$f" 2>/dev/null || true
    echo "add     .ledger/$f"
  fi
done

if [ -e "$target/.ledger/.agent-ledger-version" ]; then
  echo "keep    .ledger/.agent-ledger-version (already exists)"
else
  cp "$here/VERSION" "$target/.ledger/.agent-ledger-version"
  echo "add     .ledger/.agent-ledger-version ($version)"
fi

for f in CLAUDE.md AGENTS.md GEMINI.md; do
  if [ ! -e "$target/$f" ]; then
    cp "$here/template/pointers/$f" "$target/$f"
    echo "add     $f"
    continue
  fi

  starts=$(grep -Fc "$marker" "$target/$f" || true)
  ends=$(grep -Fc "$end_marker" "$target/$f" || true)
  if [ "$starts" -eq 1 ] && [ "$ends" -eq 1 ]; then
    start_line=$(grep -nF "$marker" "$target/$f" | cut -d: -f1)
    end_line=$(grep -nF "$end_marker" "$target/$f" | cut -d: -f1)
    if [ "$start_line" -lt "$end_line" ]; then
      echo "keep    $f (pointer already there)"
      continue
    fi
  fi

  if [ "$starts" -eq 0 ] && [ "$ends" -eq 0 ]; then
    {
      printf '\n'
      cat "$here/template/pointers/$f"
    } >> "$target/$f"
    echo "append  $f (your existing content is untouched)"
    continue
  fi

  # Remove marker lines from malformed/duplicate blocks, preserve all other
  # project text, then append one canonical block.
  tmp="$(mktemp "$target/.agent-ledger-pointer.XXXXXX")"
  awk -v start="$marker" -v end="$end_marker" '$0 != start && $0 != end { print }' "$target/$f" > "$tmp"
  {
    cat "$tmp"
    printf '\n'
    cat "$here/template/pointers/$f"
  } > "$tmp.new"
  mv "$tmp.new" "$target/$f"
  rm -f "$tmp"
  echo "repair  $f (canonical pointer block installed)"
done

cat <<MSG

Done. Next:
  1. git add .ledger CLAUDE.md AGENTS.md GEMINI.md && git commit -m "add agent ledger"
  2. Run .ledger/validate.sh . before handing work to an agent.
  3. Add a first task to .ledger/LEDGER.md (see the format at the top of that file).
  4. Open your agent(s) in the repo. They will read the pointer and the protocol.
MSG
