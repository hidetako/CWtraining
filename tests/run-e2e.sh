#!/usr/bin/env bash
# ブラウザで全機能を通しで動かす E2E テスト。
#
#   tests/run-e2e.sh                        ローカルの作業ツリーを検証
#   BASE=https://example.github.io/app \
#     tests/run-e2e.sh --remote             公開中のファイルを取得して検証
#   tests/run-e2e.sh core keyer-tutorial    スイート名を指定して一部だけ実行
#
# 必要なもの: node（18 以上）、python3、Playwright + Chromium。
# Playwright が既定の場所に無い場合は PW=/path/to/playwright/index.mjs を指定する。
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8123}"
SHOTS="${SHOTS:-$(mktemp -d)}"
export SHOTS
export PW="${PW:-$( [ -e /opt/node22/lib/node_modules/playwright/index.mjs ] \
  && echo /opt/node22/lib/node_modules/playwright/index.mjs || echo playwright )}"

ROOT="."
if [ "${1:-}" = "--remote" ]; then
  shift
  # 公開中の実ファイルを取り寄せ、それを配信して検証する
  REMOTE="${BASE:?--remote には BASE=公開URL が必要です}"
  ROOT="$(mktemp -d)"
  mkdir -p "$ROOT/css" "$ROOT/js"
  for f in index.html css/style.css $(ls js/*.js); do
    curl -fsS -o "$ROOT/$f" "$REMOTE/$f" || { echo "取得失敗: $f"; exit 1; }
  done
  echo "公開中のファイルを $ROOT に取得しました"
fi

# 引数があればそのスイートだけ、無ければ全部
if [ "$#" -gt 0 ]; then
  suites=()
  for n in "$@"; do suites+=("tests/e2e/$n.mjs"); done
else
  suites=(tests/e2e/*.mjs)
fi

python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

export BASE="http://localhost:$PORT"
fails=0
for suite in "${suites[@]}"; do
  name="$(basename "$suite" .mjs)"
  printf '%-18s ' "$name"
  if out="$(node "$suite" 2>&1)"; then
    echo "OK"
  else
    echo "NG"
    printf '%s\n' "$out" | grep -E '^✗|pageerror|console:|^失敗:' | head -n 8 | sed 's/^/    /'
    fails=$((fails + 1))
  fi
  [ -n "${VERBOSE:-}" ] && printf '%s\n' "$out" | sed 's/^/    /'
done

echo
echo "スクリーンショット: $SHOTS"
if [ "$fails" -eq 0 ]; then echo "全スイート通過"; else echo "$fails スイートが失敗"; fi
exit "$fails"
