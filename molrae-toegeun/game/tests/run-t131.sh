#!/usr/bin/env bash
# T-131 QA 실행 (game/ 에서: bash tests/run-t131.sh <rules|balance|core> [인자...])
# 기본은 고정 스냅샷(tests/.out/t131-snap = 측정 시점 git HEAD의 src·data)에서 번들한다.
# 작업 트리 그대로 돌리려면 QA_LIVE=1.
set -euo pipefail
cd "$(dirname "$0")/.."
what="${1:-rules}"; shift || true
SNAP=tests/.out/t131-snap
if [[ "${QA_LIVE:-0}" == "1" ]]; then BASE=.; else BASE=$SNAP; rm -rf $SNAP/tests; mkdir -p $SNAP/tests; (cd tests && tar --exclude=./.out --exclude=./browser -cf - .) | tar -xf - -C $SNAP/tests; fi
case "$what" in
  rules) entry=t131-rules.test.ts ;;
  balance) entry=sim/t131-balance.ts ;;
  core) entry=t124-core.test.ts ;;
  trace) entry=sim/t131-trace.ts ;;
  *) echo "unknown $what"; exit 2 ;;
esac
out=tests/.out/t131-$what.mjs
npx esbuild "$BASE/tests/$entry" --bundle --platform=node --format=esm --log-level=warning --outfile=$out
QA_DATA_DIR="${QA_DATA_DIR:-$BASE/data}" node $out "$@"
