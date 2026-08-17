#!/bin/bash
# SilverMail 起動用ランチャー（Finderからダブルクリックで起動できます）
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js が見つかりません。"
  echo "  https://nodejs.org から LTS版をインストールするか、"
  echo "  Homebrew で「brew install node」を実行してください。"
  echo ""
  read -r -p "Enterキーで閉じます..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "初回セットアップ中（依存パッケージをインストールしています）…"
  npm install --omit=dev --no-audit --no-fund || { read -r -p "インストールに失敗しました。Enterで閉じます..."; exit 1; }
fi

exec npm start
