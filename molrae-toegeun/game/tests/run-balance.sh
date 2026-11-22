#!/usr/bin/env bash
# T-124 밸런스 시뮬레이터 (game/ 에서: bash tests/run-balance.sh [시드수])
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tests/.out
npx esbuild tests/sim/balance.ts --bundle --platform=node --format=esm --log-level=warning --outfile=tests/.out/t124-balance.mjs
node tests/.out/t124-balance.mjs "${1:-1000}"
