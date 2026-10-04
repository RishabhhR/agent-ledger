#!/usr/bin/env bash
# Validate an installed agent-ledger directory.
#
#   .ledger/validate.sh /path/to/your/repo
set -euo pipefail

target="${1:-.}"
[ -d "$target" ] || { echo "ERROR: not a directory: $target" >&2; exit 1; }
target="$(cd "$target" && pwd)"
ledger="$target/.ledger/LEDGER.md"
errors=0

error() {
  printf 'ERROR: %s\n' "$*" >&2
  errors=$((errors + 1))
}

require_file() {
  if [ ! -f "$1" ]; then
    error "missing $1"
  fi
}

for file in \
  "$target/.ledger/PROTOCOL.md" \
  "$target/.ledger/LEDGER.md" \
  "$target/.ledger/roles/architect.md" \
  "$target/.ledger/roles/builder.md" \
  "$target/.ledger/roles/reviewer.md" \
  "$target/.ledger/validate.sh" \
  "$target/.ledger/.agent-ledger-version"; do
  require_file "$file"
done

if [ -f "$target/.ledger/.agent-ledger-version" ] && \
   ! grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' "$target/.ledger/.agent-ledger-version"; then
  error "invalid .ledger/.agent-ledger-version (expected MAJOR.MINOR.PATCH)"
fi

start_marker='<!-- agent-ledger:start -->'
end_marker='<!-- agent-ledger:end -->'
pointer_count=0
for file in "$target/CLAUDE.md" "$target/AGENTS.md" "$target/GEMINI.md"; do
  [ -f "$file" ] || continue
  pointer_count=$((pointer_count + 1))
  starts=$(grep -Fc "$start_marker" "$file" || true)
  ends=$(grep -Fc "$end_marker" "$file" || true)
  [ "$starts" -eq 1 ] || error "$file must contain exactly one agent-ledger start marker (found $starts)"
  [ "$ends" -eq 1 ] || error "$file must contain exactly one agent-ledger end marker (found $ends)"
  if [ "$starts" -eq 1 ] && [ "$ends" -eq 1 ]; then
    start_line=$(grep -nF "$start_marker" "$file" | cut -d: -f1)
    end_line=$(grep -nF "$end_marker" "$file" | cut -d: -f1)
    [ "$start_line" -lt "$end_line" ] || error "$file has its end marker before its start marker"
  fi
done
[ "$pointer_count" -gt 0 ] || error "at least one of CLAUDE.md, AGENTS.md, or GEMINI.md is required"

if [ -f "$ledger" ]; then
  if grep -nE '^<<<<<<<|^>>>>>>>' "$ledger" >/dev/null 2>&1; then
    error "$ledger contains a merge-conflict marker"
  fi
  if grep -nE '^=======$' "$ledger" >/dev/null 2>&1; then
    error "$ledger contains a merge-conflict marker: ======="
  fi

  for section in '## Decisions needed' '## Tasks' '## Done' '## Checkpoints'; do
    grep -qF "$section" "$ledger" || error "$ledger is missing section: $section"
  done

  # Emit only real entry headings, ignoring the commented format example.
  headings=$(awk '
    BEGIN { in_comment=0; section="" }
    {
      has_open=index($0, "<!--")
      has_close=index($0, "-->")
      if (has_open) in_comment=1
      if (!in_comment && $0 ~ /^## (Decisions needed|Tasks|Done|Checkpoints)$/) section=$0
      if (!in_comment && $0 ~ /^### \[/) print NR "\t" section "\t" $0
      if (has_close) in_comment=0
    }
  ' "$ledger")

  seen_ids=''
  while IFS=$'\t' read -r line_no section heading; do
    [ -n "$heading" ] || continue
    if ! printf '%s\n' "$heading" | grep -Eq '^### \[(TASK|DEC)-[0-9]{3,}\] status:(open|done|resolved|closed) from:[^ ]+ to:[^ ]+ opened:[0-9]{4}-[0-9]{2}-[0-9]{2}(T[^ ]+)?( [^ ]+:[^ ]+)*$'; then
      error "$ledger:$line_no has an invalid entry heading: $heading"
      continue
    fi

    id=$(printf '%s\n' "$heading" | sed -E 's/^### \[([^]]+)\].*/\1/')
    status=$(printf '%s\n' "$heading" | sed -E 's/^### \[[^]]+\] status:([^ ]+).*/\1/')
    case "$status" in
      resolved|closed) section_status="done" ;;
      *) section_status="$status" ;;
    esac
    case " $seen_ids " in
      *" $id "*) error "$ledger:$line_no duplicates entry $id" ;;
      *) seen_ids="$seen_ids $id" ;;
    esac

    case "$id:$section_status:$section" in
      TASK-*:*:'## Tasks') : ;;
      TASK-*:done:'## Done') : ;;
      DEC-*:open:'## Decisions needed') : ;;
      DEC-*:done:'## Done') : ;;
      *) error "$ledger:$line_no places $id ($status) under the wrong section: ${section:-<none>}" ;;
    esac
  done <<< "$headings"
fi

if [ "$errors" -gt 0 ]; then
  printf 'Validation failed with %s error(s).\n' "$errors" >&2
  exit 1
fi

echo "Validation passed: $target"
