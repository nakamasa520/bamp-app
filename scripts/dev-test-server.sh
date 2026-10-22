#!/usr/bin/env bash
# テスト用: AI_MOCK 付き・ローカルD1(毎回初期化)で起動。PORT / PERSIST / SEED で変更可
cd "$(dirname "$0")/.."
P=${PERSIST:-.wrangler/test-state}; rm -rf "$P"
npx wrangler d1 migrations apply bamp-task --local --persist-to "$P" -c wrangler.test.jsonc >/dev/null 2>&1
npx wrangler d1 execute bamp-task --local --persist-to "$P" -c wrangler.test.jsonc --file=${SEED:-seed/real.sql} >/dev/null 2>&1
exec npx wrangler dev --local --persist-to "$P" -c wrangler.test.jsonc --port ${PORT:-8787}
