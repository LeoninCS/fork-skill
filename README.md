# fork-skill

[English](#english) | [中文](#中文)

## English

`fork-skill` lets a user give one URL and have Codex reproduce the frontend in the current project with evidence-driven visual and behavioral validation. It focuses on UI, animations, interactions, and browser-visible state.

## Install

```bash
node scripts/install.mjs
```

This installs the skill at `~/.codex/skills/fork-skill`.

Install runtime tools in the target project:

```bash
npm install -D playwright pixelmatch pngjs
npx playwright install chromium
brew install wget
```

## One-Link Usage

Ask Codex:

```text
Recreate https://example.com
I want to recreate https://example.com
Copy https://example.com
Rebuild https://example.com
Clone https://example.com into this project
```

Any natural clone/recreation request with a URL will trigger the skill.

The skill defaults to:

- source URL from the prompt
- target route `/`
- viewports `desktop=1440x900,mobile=390x844`
- evidence at `.fork-skill/evidence/latest`
- validation report at `.fork-skill/reports/latest`
- screenshot threshold `0.02`
- frontend scope with static fixtures for visible data

## Manual Pipeline

Initialize mirror, runbook, and starter interactions:

```bash
node "$HOME/.codex/skills/fork-skill/scripts/one-link-init.mjs" --url https://example.com/
```

Then read `.fork-skill/runbook.json` and run the generated commands. The runbook contains the exact mirrored source URL, source server command, capture commands, and validation command.

Serve the mirrored source:

```bash
python3 -m http.server 4173 --directory .fork-skill/source
```

Capture source evidence:

```bash
node "$HOME/.codex/skills/fork-skill/scripts/capture-evidence.mjs" \
  --source http://127.0.0.1:4173/example.com/index.html \
  --out .fork-skill/evidence/source-pass \
  --viewports desktop=1440x900,mobile=390x844
```

After implementing the clone, capture paired evidence:

```bash
node "$HOME/.codex/skills/fork-skill/scripts/capture-evidence.mjs" \
  --source http://127.0.0.1:4173/example.com/index.html \
  --target http://127.0.0.1:5173/ \
  --out .fork-skill/evidence/latest \
  --viewports desktop=1440x900,mobile=390x844 \
  --interactions .fork-skill/interactions.json
```

Validate:

```bash
node "$HOME/.codex/skills/fork-skill/scripts/validate-evidence.mjs" \
  --evidence .fork-skill/evidence/latest \
  --out .fork-skill/reports/latest \
  --threshold 0.02
```

## Evidence Artifacts

- `.fork-skill/source/manifest.json`: mirrored source entry candidates.
- `.fork-skill/runbook.json`: generated commands and local source URL.
- `.fork-skill/interactions.json`: interaction matrix.
- `.fork-skill/evidence/latest/source/**`: source screenshots, animation frames, DOM/style dumps, resource logs, interaction results.
- `.fork-skill/evidence/latest/target/**`: target screenshots, animation frames, DOM/style dumps, resource logs, interaction results.
- `.fork-skill/reports/latest/report.md`: human-readable validation report.
- `.fork-skill/reports/latest/diffs/**.png`: screenshot diff images.

## Interaction Matrix

Add important flows to `.fork-skill/interactions.json`:

```json
[
  {"name":"nav-hover","action":"hover","selector":"nav a:first-child","wait":300},
  {"name":"menu-open","action":"click","selector":"button[aria-label='Menu']","wait":500},
  {"name":"form-fill","action":"fill","selector":"input[type='email']","value":"test@example.com","wait":300},
  {"name":"scroll-middle","action":"scroll","y":800,"wait":500}
]
```

Supported actions: `hover`, `focus`, `click`, `dblclick`, `fill`, `press`, `scroll`, `drag`, `wait`.

## One-to-One Standard

The clone is ready when desktop and mobile screenshots pass the threshold, key interactions pass, animation frames are captured, visible text and primary media match, static fixture states cover visible data, and project checks pass.

## 中文

`fork-skill` 让用户只给一个 URL，就能让 Codex 在当前项目里复刻该网页的前端体验，并用证据包验证视觉和交互一致性。重点覆盖 UI、动画、交互和浏览器可见状态。

## 安装

```bash
node scripts/install.mjs
```

脚本会把 skill 安装到 `~/.codex/skills/fork-skill`。

在目标项目里安装运行依赖：

```bash
npm install -D playwright pixelmatch pngjs
npx playwright install chromium
brew install wget
```

## 一条指令使用

向 Codex 发送：

```text
复刻 https://example.com
我想复刻 https://example.com
复刻这个网站 https://example.com
仿站 https://example.com
还原 https://example.com
照着 https://example.com 做一个
```

带有复刻、仿站、还原、照着做意图和 URL 的自然语言请求会触发这个 skill。

默认规则：

- 源地址来自提示词里的 URL
- 目标路由为 `/`
- 视口为 `desktop=1440x900,mobile=390x844`
- 证据包输出到 `.fork-skill/evidence/latest`
- 验证报告输出到 `.fork-skill/reports/latest`
- 截图差异阈值为 `0.02`
- 聚焦前端复刻，可见数据使用静态 fixtures

## 手动流程

初始化镜像、runbook 和初始交互矩阵：

```bash
node "$HOME/.codex/skills/fork-skill/scripts/one-link-init.mjs" --url https://example.com/
```

然后读取 `.fork-skill/runbook.json` 并执行其中生成的命令。runbook 包含精确的本地源页面 URL、源页面服务命令、证据采集命令和验证命令。

启动源页面镜像服务：

```bash
python3 -m http.server 4173 --directory .fork-skill/source
```

采集源页面证据：

```bash
node "$HOME/.codex/skills/fork-skill/scripts/capture-evidence.mjs" \
  --source http://127.0.0.1:4173/example.com/index.html \
  --out .fork-skill/evidence/source-pass \
  --viewports desktop=1440x900,mobile=390x844
```

实现复刻页面后，采集 source/target 双端证据：

```bash
node "$HOME/.codex/skills/fork-skill/scripts/capture-evidence.mjs" \
  --source http://127.0.0.1:4173/example.com/index.html \
  --target http://127.0.0.1:5173/ \
  --out .fork-skill/evidence/latest \
  --viewports desktop=1440x900,mobile=390x844 \
  --interactions .fork-skill/interactions.json
```

验证结果：

```bash
node "$HOME/.codex/skills/fork-skill/scripts/validate-evidence.mjs" \
  --evidence .fork-skill/evidence/latest \
  --out .fork-skill/reports/latest \
  --threshold 0.02
```

## 证据产物

- `.fork-skill/source/manifest.json`：镜像源页面入口候选。
- `.fork-skill/runbook.json`：生成的命令和本地源页面 URL。
- `.fork-skill/interactions.json`：交互矩阵。
- `.fork-skill/evidence/latest/source/**`：源页面截图、动画帧、DOM/style dump、资源日志、交互结果。
- `.fork-skill/evidence/latest/target/**`：目标页面截图、动画帧、DOM/style dump、资源日志、交互结果。
- `.fork-skill/reports/latest/report.md`：人工可读验证报告。
- `.fork-skill/reports/latest/diffs/**.png`：截图差异图。

## 交互矩阵

把关键交互写进 `.fork-skill/interactions.json`：

```json
[
  {"name":"nav-hover","action":"hover","selector":"nav a:first-child","wait":300},
  {"name":"menu-open","action":"click","selector":"button[aria-label='Menu']","wait":500},
  {"name":"form-fill","action":"fill","selector":"input[type='email']","value":"test@example.com","wait":300},
  {"name":"scroll-middle","action":"scroll","y":800,"wait":500}
]
```

支持的动作：`hover`、`focus`、`click`、`dblclick`、`fill`、`press`、`scroll`、`drag`、`wait`。

## 一比一标准

当桌面和移动截图通过阈值、关键交互通过验证、动画帧已采集、可见文字和主要媒体匹配、静态 fixture 覆盖可见数据状态、项目检查通过时，复刻结果即可交付。
