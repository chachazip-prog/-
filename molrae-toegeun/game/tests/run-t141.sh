#!/usr/bin/env bash
# T-141 QA 실행 (game/ 에서: bash tests/run-t141.sh <tour|balance|maps|gap|trace> [인자...])
# 항상 작업 트리(최신 커밋) 그대로 번들한다(D-114: 스냅샷 없음). 데이터 폴더는 QA_DATA_DIR로 바꿀 수 있음.
set -euo pipefail
cd "$(dirname "$0")/.."
what="${1:-tour}"; shift || true
case "$what" in
  tour) entry=sim/t141-tour.ts ;;
  balance) entry=sim/t141-balance.ts ;;
  maps) entry=sim/t141-maps.ts ;;
  gap) entry=sim/t141-gap.ts ;;
  trace) entry=sim/t141-trace.ts ;;
  *) echo "unknown $what"; exit 2 ;;
esac
mkdir -p tests/.out/t141
out=tests/.out/t141/$what.mjs
npx esbuild "tests/$entry" --bundle --platform=node --format=esm --log-level=warning --outfile=$out
node $out "$@"
