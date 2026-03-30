# LTCast — Claude 工作規則

## 跨平台同步流程（Mac ↔ Windows）

**每次改完 Mac：**
1. `git commit` → `git push`
2. 再告訴 Windows Claude 去 `git pull`

**每次 Mac 開始工作前：**
1. 先 `git pull origin master`，確保拿到 Windows 最新改動

**規則：**
- 改 Mac 的東西不准動到 Windows 專屬檔案（installer、NSIS 設定等）
- **絕對禁止**在 commit message 加任何 `Co-Authored-By`、`co-authored-by`、`Generated with Claude`、或任何提及 AI/Claude 的署名文字
- 版本號不能擅自升級，要等主人說

## 簡單指令對照表

| 你說 | 我做什麼 |
|------|----------|
| **同步流程** / **準備給 Windows 改** | git pull → 確認最新 → 告訴你可以叫 Windows 開始 |
| **Mac 改完，推上去** | git add → commit → push |
| **抓 bug** | 全面檢查近期改動的檔案，修完 commit push |
| **打包 0.x.x** | 確認版本號 → 改 package.json → 打包 Mac Universal DMG → push tag + GitHub Release |
| **給 Windows 的指令** | 整理目前 Mac 所有改動，輸出可直接貼給 Windows Claude 的完整指令 |

## Mac 打包流程

```
npm run build
electron-builder --mac --dir --x64
electron-builder --mac --dir --arm64
node scripts/create-universal.js
bash scripts/patch-mac-plist.sh dist/mac-universal/LTCast.app
bash scripts/sign-mac.sh dist/mac-universal/LTCast.app
electron-builder --mac --pd dist/mac-universal --publish never
```

## ⚠️ Commit 署名規範（Mac 和 Windows 都必須遵守）

**任何 commit 都不能包含以下內容：**
- `Co-Authored-By: Claude ...`
- `Co-authored-by:` 任何形式
- `Generated with Claude Code`
- `🤖 Generated with`
- 任何提及 AI、Claude、Anthropic 的署名

Git commit message 只寫改了什麼，不加任何 AI 工具的署名。

## 重要提醒

- `package-lock.json` 在 `.gitignore`，不要 commit 它
- ffmpeg binary 在 `node_modules/ffmpeg-static/`，Mac 要有 `ffmpeg`（arm64）和 `bin/darwin/x64/ffmpeg`
- Windows 有自己的 Claude Code agent，兩邊的 source code 是同一個 repo
- 推上去之前永遠先 `git pull`，避免 conflict
