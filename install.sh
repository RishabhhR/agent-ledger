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
target=""

usage() {
  cat <<'MSG'
Usage: ./install.sh [--check|--diff|--update] [REPO]

  install (default)  Add missing kit files and repair malformed pointers.
  --check            Validate an installed kit without changing files.
  --diff             Show differences from the kit templates.
  --update           Safe re-run alias for install; add missing files and repair pointers.

Existing project files are not overwritten. Use --diff before deciding
whether a customized existing file should be updated manually.
MSG
}

for arg in "$@"; do
  case "$arg" in
    --check|--diff|--update)
      requested_mode="${arg#--}"
      if [ "$mode" != "install" ] && [ "$mode" != "$requested_mode" ]; then
        echo "ERROR: choose only one of --check, --diff, or --update." >&2
        usage >&2
        exit 2
      fi
      mode="$requested_mode"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      echo "ERROR: unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$target" ]; then
        echo "ERROR: expected one repository path, got an extra argument: $arg" >&2
        usage >&2
        exit 2
      fi
      target="$arg"
      ;;
  esac
done

target="${target:-.}"
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

if [ "$mode" = "update" ]; then
  echo "update: using the same non-destructive install/repair actions"
fi

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
  start_line=0
  end_line=0
  if [ "$starts" -ge 1 ]; then
    start_line=$(grep -nF "$marker" "$target/$f" | head -n1 | cut -d: -f1)
  fi
  if [ "$ends" -ge 1 ]; then
    end_line=$(grep -nF "$end_marker" "$target/$f" | head -n1 | cut -d: -f1)
  fi
  if [ "$starts" -eq 1 ] && [ "$ends" -eq 1 ]; then
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

  # Remove complete managed blocks from malformed/duplicate pointers, preserve
  # all project text outside those blocks, then append one canonical block.
  # Keep an incomplete block's text: it may contain project-owned content.
  pointer_tmp_dir="${pointer_tmp_dir:-$(mktemp -d "${TMPDIR:-/tmp}/agent-ledger-pointer.XXXXXX")}"
  tmp="$pointer_tmp_dir/current"
  if [ "$starts" -ge 1 ] && [ "$ends" -ge 1 ] && [ "$start_line" -lt "$end_line" ]; then
    awk -v start="$marker" -v end="$end_marker" '
      $0 == start { in_block=1; next }
      in_block && $0 == end { in_block=0; next }
      !in_block { print }
    ' "$target/$f" > "$tmp"
  else
    awk -v start="$marker" -v end="$end_marker" '$0 != start && $0 != end { print }' "$target/$f" > "$tmp"
  fi
  {
    cat "$tmp"
    printf '\n'
    cat "$here/template/pointers/$f"
  } > "$tmp.new"
  mv "$tmp.new" "$target/$f"
  echo "repair  $f (canonical pointer block installed)"
done

if [ -n "${pointer_tmp_dir:-}" ]; then
  rm -rf "$pointer_tmp_dir"
fi

cat <<MSG

Done. Next:
  1. git add .ledger CLAUDE.md AGENTS.md GEMINI.md && git commit -m "add agent ledger"
  2. Run .ledger/validate.sh . before handing work to an agent.
  3. Add a first task to .ledger/LEDGER.md (see the format at the top of that file).
  4. Open your agent(s) in the repo. They will read the pointer and the protocol.
MSG
