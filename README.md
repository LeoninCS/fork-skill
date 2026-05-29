# fork-skill

`fork-skill` lets a user give one URL and have Codex reproduce the frontend in the current project with evidence-driven visual and behavioral validation. It focuses on UI, animations, interactions, and browser-visible state.

## Install

```bash
mkdir -p ~/.codex/skills
ln -s /Users/sealos/repositories/fork-skill ~/.codex/skills/fork-skill
export FORK_SKILL="$HOME/.codex/skills/fork-skill"
```

Install runtime tools in the target project:

```bash
npm install -D playwright pixelmatch pngjs
npx playwright install chromium
brew install wget
```

## One-Link Usage

Ask Codex:

```text
Use $fork-skill to clone https://example.com into this project one-to-one.
```

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
node "$FORK_SKILL/scripts/one-link-init.mjs" --url https://example.com/
```

Then read `.fork-skill/runbook.json` and run the generated commands. The runbook contains the exact mirrored source URL, source server command, capture commands, and validation command.

Serve the mirrored source:

```bash
python3 -m http.server 4173 --directory .fork-skill/source
```

Capture source evidence:

```bash
node "$FORK_SKILL/scripts/capture-evidence.mjs" \
  --source http://127.0.0.1:4173/example.com/index.html \
  --out .fork-skill/evidence/source-pass \
  --viewports desktop=1440x900,mobile=390x844
```

After implementing the clone, capture paired evidence:

```bash
node "$FORK_SKILL/scripts/capture-evidence.mjs" \
  --source http://127.0.0.1:4173/example.com/index.html \
  --target http://127.0.0.1:5173/ \
  --out .fork-skill/evidence/latest \
  --viewports desktop=1440x900,mobile=390x844 \
  --interactions .fork-skill/interactions.json
```

Validate:

```bash
node "$FORK_SKILL/scripts/validate-evidence.mjs" \
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
