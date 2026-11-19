#!/usr/bin/env bash
# Bundles the real pages for a browser smoke test (no Next.js needed). Output: test-harness/dist
set -euo pipefail
cd "$(dirname "$0")"
ESB=${ESBUILD:-/opt/npm-tools/node_modules/esbuild/bin/esbuild}
export NODE_PATH=${NODE_PATH:-/home/claude/.npm-global/lib/node_modules}
mkdir -p dist
"$ESB" entry.tsx --bundle --outfile=dist/bundle.js --jsx=automatic --loader:.css=css --format=iife --target=es2022 \
  --define:process.env.NEXT_PUBLIC_API_URL="\"${NEXT_PUBLIC_API_URL:-}\"" --define:process.env.NODE_ENV='"development"' \
  --alias:next/link=./stubs/next-link.tsx --alias:next/navigation=./stubs/next-navigation.ts --alias:@=.. --log-level=warning
cat > dist/index.html <<'H'
<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/bundle.css"><title>ClipArab harness</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>
H
echo built
