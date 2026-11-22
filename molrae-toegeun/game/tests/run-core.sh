#!/usr/bin/env bash
# T-124 코어 검증 실행 (game/ 에서: bash tests/run-core.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tests/.out
npx esbuild tests/t124-core.test.ts --bundle --platform=node --format=esm --log-level=warning --outfile=tests/.out/t124-core.mjs
node tests/.out/t124-core.mjs
