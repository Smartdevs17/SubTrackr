#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <target> <crash-file>" >&2
  exit 2
fi

target="$1"
crash_file="$2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
regression_dir="$repo_root/contracts/subscription/tests/regressions"
mkdir -p "$regression_dir"

sha="$(sha256sum "$crash_file" | awk '{print $1}')"
out="$regression_dir/${target}_${sha}.bin"
cp "$crash_file" "$out"

cat <<MSG
Crash copied to: $out

Reproduce:
  cd contracts
  cargo fuzz run $target $out

Minimize:
  cd contracts
  cargo fuzz tmin $target $out

Promote this file into a deterministic regression test by loading it from
contracts/subscription/tests/regressions and replaying the matching target logic.
MSG
