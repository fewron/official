#!/bin/bash

# 1. 外部（GitHub UI）での修正を吸い込む
echo "🔄 Step 1: GitHubから最新の修正を同期中..."
git pull origin main

# 2. サイト生成（Place API連携済み）を実行
echo "🏗️ Step 2: サイトを生成しています..."
node scripts/build.js

# 3. 変更をGitHubへ送る
echo "📡 Step 3: ネットに公開しています..."
git add .
git commit -m "Auto-update: $(date +'%Y-%m-%d %H:%M')"
git push origin main

echo "✅ すべて完了！数分後に fewron.jp に反映されます。"
