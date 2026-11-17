#!/bin/bash
# Local replacement for block-dangerous-git.sh: allows a plain `git push`,
# blocks pushes that rewrite or delete remote history.
#
# Only a command that starts with `git` is judged. Quoted strings and heredoc
# bodies are dropped first, so a commit message or a doc that mentions a
# blocked command passes. Accepted misses: a quoted refspec
# (`git push origin "+main"`) and git run through `bash -c` or an alias.

INPUT=$(cat)
# Without jq, match against the raw JSON rather than failing open.
if command -v jq >/dev/null; then
  COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
  RAW=0
else
  COMMAND=${INPUT//[\"\{\}]/ }
  RAW=1
fi

DANGEROUS_PATTERNS=(
  "git( .*)? push( .*)? (--force|--force-with-lease|--force-if-includes|--delete|--mirror|--prune|-[a-zA-Z]*[fd][a-zA-Z]*)(=[^ ]*)?( |$)"
  "git( .*)? push( .*)? [+:][^ ]+"
  "git( .*)? reset( .*)? --hard"
  "git( .*)? clean( .*)? (--force|-[a-zA-Z]*f[a-zA-Z]*)( |$)"
  "git( .*)? branch( .*)? (-[a-zA-Z]*D[a-zA-Z]*|--force)( |$)"
  "git( .*)? (checkout|restore)( .*)? \.( |$)"
)

# Drop heredoc bodies, replace each quoted string with Q, then put each
# command of a chain, subshell or substitution on its own line.
strip_and_split() {
  awk '
    { text = text $0 "\n" }
    END {
      out = ""; n = length(text); i = 1; delim = ""
      while (i <= n) {
        c = substr(text, i, 1)
        if (c == "\n" && delim != "") {
          out = out "\n"; i++
          # Skip lines up to and including the heredoc delimiter.
          while (i <= n) {
            j = index(substr(text, i), "\n"); if (j == 0) j = n - i + 2
            line = substr(text, i, j - 1); i += j
            sub(/^[ \t]+/, "", line)
            if (line == delim) break
          }
          delim = ""; continue
        }
        if (c == "<" && substr(text, i, 2) == "<<" && substr(text, i, 3) != "<<<") {
          rest = substr(text, i + 2)
          if (match(rest, /^-?[ \t]*["\047]?[A-Za-z_][A-Za-z0-9_]*["\047]?/)) {
            word = substr(rest, 1, RLENGTH); gsub(/[-\t "\047]/, "", word)
            delim = word; out = out "<<Q"; i += 2 + RLENGTH; continue
          }
        }
        if (c == "\\") { out = out substr(text, i, 2); i += 2; continue }
        if (c == "\047") {
          j = index(substr(text, i + 1), "\047"); if (j == 0) j = n - i + 1
          out = out "Q"; i += j + 1; continue
        }
        if (c == "\"") {
          i++
          while (i <= n) {
            d = substr(text, i, 1)
            if (d == "\\") { i += 2; continue }
            i++
            if (d == "\"") break
          }
          out = out "Q"; continue
        }
        out = out c; i++
      }
      gsub(/[;&|(){}`]/, "\n", out)
      print out
    }'
}

if [ "$RAW" = 1 ]; then
  SEGMENTS=$COMMAND
else
  SEGMENTS=$(printf '%s\n' "$COMMAND" | strip_and_split)
fi

while IFS= read -r segment; do
  if [ "$RAW" = 0 ]; then
    # Drop leading keywords, wrappers and VAR=value assignments, then judge
    # the segment only if what is left starts with git.
    segment=$(printf '%s' "$segment" | sed -E 's/^[[:space:]]*//
:a
s/^(then|do|else|!|time|sudo|command|env|nohup|exec|[A-Za-z_][A-Za-z0-9_]*=[^ ]*)[[:space:]]+//
ta')
    case $segment in git|git[[:space:]]*) ;; *) continue ;; esac
  fi
  for pattern in "${DANGEROUS_PATTERNS[@]}"; do
    if printf '%s\n' "$segment" | grep -qE "$pattern"; then
      echo "BLOCKED: '$segment' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
      exit 2
    fi
  done
done <<< "$SEGMENTS"

exit 0
