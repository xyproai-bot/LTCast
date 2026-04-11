# LTCast — Claude 工作規則

## 專案概覽

LTCast 是 Electron + React + TypeScript 的 LTC timecode player。
- **框架**：Electron 40 + React 18 + Zustand + Electron Vite
- **輸出協議**：LTC（音訊）、MTC（MIDI quarter-frame / full-frame SysEx）、Art-Net（UDP OpTimeCode）
- **測試框架**：Vitest 4.1
- **打包**：electron-builder（Windows NSIS / macOS Universal DMG）
- **CI/CD**：GitHub Actions（`.github/workflows/build.yml`），tag 觸發

### 關鍵目錄結構

```
src/
  main/index.ts              ← Electron 主程序（IPC、FFmpeg、Art-Net UDP socket）
  preload/index.ts            ← Context bridge（window.api.*）
  renderer/src/
    audio/
      AudioEngine.ts          ← 雙 AudioContext 架構（music + LTC）
      LtcDecoder.ts           ← LTC 解碼
      LtcDetector.ts          ← LTC 通道自動偵測
      ltcProcessor.js         ← AudioWorklet：LTC 解碼
      ltcEncoderProcessor.js  ← AudioWorklet：LTC 編碼輸出
      MtcOutput.ts            ← MTC MIDI 輸出
      ArtNetOutput.ts         ← Art-Net UDP 輸出
      timecodeConvert.ts      ← SMPTE timecode ↔ frame 換算（drop-frame 29.97 / NDF 25,30）
      AudioAligner.ts         ← 音訊/LTC 時間對齊
      BpmDetector.ts          ← BPM 偵測
      __tests__/
        timecodeConvert.test.ts ← 81 個 unit tests（Vitest）
    components/
      Waveform.tsx, Transport.tsx, TimecodeDisplay.tsx,
      DevicePanel.tsx, SetlistPanel.tsx, StatusBar.tsx,
      PresetBar.tsx, TapBpm.tsx, Toast.tsx, ErrorBoundary.tsx
    store.ts                  ← Zustand store（PlayState、設備、preset、setlist）
    App.tsx, main.tsx, i18n.ts, constants.ts, globals.css
```

### 常用指令

```bash
npm run dev                  # 開發模式（hot reload）
npm run build                # 編譯（electron-vite）
npx vitest run               # 跑全部測試
npx vitest run --reporter=verbose  # 詳細測試輸出
npm run package:win          # Windows NSIS installer
```

---

## ⚠️ Commit 署名規範（Mac 和 Windows 都必須遵守）

**任何 commit 都不能包含以下內容：**
- `Co-Authored-By: Claude ...`
- `Co-authored-by:` 任何形式
- `Generated with Claude Code`
- `🤖 Generated with`
- 任何提及 AI、Claude、Anthropic 的署名

Git commit message 只寫改了什麼，不加任何 AI 工具的署名。

---

## 跨平台同步流程（Mac ↔ Windows）

**每次改完 Mac：**
1. `git commit` → `git push`
2. 再告訴 Windows Claude 去 `git pull`

**每次 Mac 開始工作前：**
1. 先 `git pull origin master`，確保拿到 Windows 最新改動

**規則：**
- 改 Mac 的東西不准動到 Windows 專屬檔案（installer、NSIS 設定等）
- **絕對禁止**在 commit message 加任何 AI 署名（見上方規範）
- 版本號不能擅自升級，要等主人說

## 簡單指令對照表

| 你說 | 我做什麼 |
|------|----------|
| **同步流程** / **準備給 Windows 改** | git pull → 確認最新 → 告訴你可以叫 Windows 開始 |
| **Mac 改完，推上去** | git add → commit → push |
| **抓 bug** | 全面檢查近期改動的檔案，修完 commit push |
| **打包 0.x.x** | 確認版本號 → 改 package.json → 打包 → push tag + GitHub Release |
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

## 重要提醒

- `package-lock.json` 在 `.gitignore`，不要 commit 它
- ffmpeg binary 在 `node_modules/ffmpeg-static/`，Mac 要有 `ffmpeg`（arm64）和 `bin/darwin/x64/ffmpeg`
- Windows 有自己的 Claude Code agent，兩邊的 source code 是同一個 repo
- 推上去之前永遠先 `git pull`，避免 conflict

---

## Multi-Agent Sprint 工作流程

當主人說「**開 sprint**」或指派新功能時，啟動以下三角色流程。
每個角色是一個獨立的 Claude agent（用 Agent tool 啟動）。

### 流程圖

```
主人提出需求
     │
     ▼
┌──────────┐
│ Planner  │ ← 展開 spec + 定義成功標準
└────┬─────┘
     │ sprint-contract.md
     ▼
┌──────────┐
│Generator │ ← 按 contract 實作，不得自行 review
└────┬─────┘
     │ 改好的 code
     ▼
┌──────────┐
│Evaluator │ ← 獨立驗證，跑測試，出 report
└────┬─────┘
     │
     ├─ FAIL → 回 Generator（附上失敗原因）
     │
     └─ PASS → 結束，報告主人
```

### Role 1: Planner Agent

**觸發**：主人提出新功能或 bug fix 需求
**工具**：Read、Glob、Grep、Agent（Explore subagent）— 只讀不寫

**職責：**
1. 讀懂需求，掃描相關 source code 確認現有架構
2. 輸出 `sprint-contract.md` 到 `.claude/` 目錄，內容包含：

```markdown
# Sprint Contract: [功能名稱]

## 需求摘要
[一段話描述要做什麼、為什麼做]

## 成功標準（Acceptance Criteria）
- [ ] AC-1: [具體、可驗證的條件]
- [ ] AC-2: ...

## 影響範圍
- 要改的檔案：[列出路徑]
- 不能動的檔案：[列出禁區]
- 要新增的檔案：[如有]

## 技術決策
- [列出架構選擇和理由]

## 測試計畫
- 新增哪些 test cases（檔名 + describe block 名稱）
- 要驗證的 protocol 正確性（LTC / MTC / Art-Net）

## 跨平台注意事項
- macOS 影響：[有/無，說明]
- Windows 影響：[有/無，說明]
```

3. 如果需求不明確，直接向主人提問（AskUserQuestion），不要猜

**Planner 禁止做的事：**
- 不准寫 code
- 不准改任何檔案
- 不准決定版本號

### Role 2: Generator Agent

**觸發**：Planner 完成 sprint-contract.md
**工具**：Read、Edit、Write、Bash、Glob、Grep — 全部讀寫工具

**職責：**
1. 讀 `.claude/sprint-contract.md`，逐條對照 Acceptance Criteria 實作
2. 寫 code，寫測試，確保 `npx vitest run` 在本機通過
3. 完成後輸出 `generator-report.md` 到 `.claude/`：

```markdown
# Generator Report

## 完成的 AC
- [x] AC-1: [做了什麼]
- [x] AC-2: ...

## 改動清單
| 檔案 | 改動類型 | 說明 |
|------|---------|------|
| src/renderer/src/audio/MtcOutput.ts | 修改 | 加了 XX 功能 |

## 新增測試
- `src/renderer/src/audio/__tests__/xxx.test.ts` — N 個 test cases

## 已知風險
- [如有]
```

**Generator 禁止做的事：**
- 不准自己 review 自己的 code（交給 Evaluator）
- 不准 commit（等 Evaluator 通過）
- 不准改 sprint-contract.md
- 不准升版本號

### Role 3: Evaluator Agent

**觸發**：Generator 完成 generator-report.md
**工具**：Read、Bash、Glob、Grep — 只讀 + 跑測試

**職責：**
1. 讀 sprint-contract.md 的 Acceptance Criteria
2. 讀 generator-report.md 的改動清單
3. 獨立逐項驗證：

#### 驗證清單

**通用檢查：**
- [ ] `npx vitest run` 全部通過（0 failures）
- [ ] `npm run build` 編譯成功（0 errors）
- [ ] 沒有 TypeScript 型別錯誤
- [ ] 沒有引入未使用的 import 或變數
- [ ] 沒有動到 sprint-contract.md 列出的禁區檔案

**LTC Timecode 精度：**
- [ ] drop-frame 29.97 換算正確（round-trip: TC→frames→TC = identity）
- [ ] non-drop 25/30 fps 換算正確
- [ ] LTC AudioWorklet（ltcProcessor.js / ltcEncoderProcessor.js）無迴歸
- [ ] AudioEngine.ts 的 dual-context 架構沒被破壞

**MTC Output 正確性：**
- [ ] MtcOutput.ts quarter-frame 訊息格式符合 MIDI spec（0xF1 + nibble）
- [ ] full-frame SysEx 格式正確（F0 7F 7F 01 01 ... F7）
- [ ] fps 旗標對應正確（24/25/29.97DF/30）

**Art-Net Output 正確性：**
- [ ] ArtNetOutput.ts OpTimeCode packet 格式符合 Art-Net spec
- [ ] UDP broadcast 目標 IP 可設定
- [ ] IPC 呼叫路徑（renderer → main via preload）完整

**MIDI Cue List / Setlist 功能：**
- [ ] SetlistPanel.tsx 渲染正確
- [ ] store.ts 的 setlist 狀態管理無迴歸
- [ ] preset 存取包含 setlist 資料

**跨平台相容性：**
- [ ] 沒有使用 platform-specific API 而未加條件判斷
- [ ] IPC handler（src/main/index.ts）的 path 處理用 `path.join`
- [ ] 沒有 hardcode Unix/Windows 路徑分隔符

4. 輸出 `evaluator-report.md` 到 `.claude/`：

```markdown
# Evaluator Report

## 測試結果
- vitest: X passed, Y failed
- build: PASS/FAIL

## AC 驗證
- [x] AC-1: PASS — [說明]
- [ ] AC-2: FAIL — [失敗原因 + 重現方式]

## 發現的問題
1. [問題描述 + 建議修法]

## 最終判定：PASS / FAIL
```

**Evaluator 禁止做的事：**
- 不准改 code（只能報告問題）
- 不准 commit
- 不准改 sprint-contract.md 或 generator-report.md

### Sprint 迴圈規則

```
1. Planner → 輸出 sprint-contract.md → 等主人確認
2. 主人確認 → Generator 開始實作 → 輸出 generator-report.md
3. Evaluator 驗證 → 輸出 evaluator-report.md
4. 如果 FAIL：
   - Evaluator report 交給 Generator
   - Generator 修復 → 更新 generator-report.md
   - 回到步驟 3（最多重試 3 次）
5. 如果 PASS：
   - 報告主人，等主人決定是否 commit
6. 3 次都 FAIL → 停下來，把所有 report 給主人看，讓主人決定
```

### 啟動範例

主人說：「開 sprint：加上 NDI output 支援」

Claude 執行：
1. 啟動 Planner agent → 掃 repo、問細節、產出 sprint-contract.md
2. 給主人看 contract，等確認
3. 啟動 Generator agent → 讀 contract、寫 code、寫測試
4. 啟動 Evaluator agent → 讀 contract + report、跑測試、逐項驗證
5. 根據結果決定迴圈或結束

### Sprint 產出檔案

所有 sprint 文件放在 `.claude/` 目錄：
- `.claude/sprint-contract.md` — Planner 輸出
- `.claude/generator-report.md` — Generator 輸出
- `.claude/evaluator-report.md` — Evaluator 輸出

每次新 sprint 會覆蓋這些檔案。如需保留歷史，主人可以手動備份。
