---
name: fork-skill
description: Use when a user gives a webpage URL with any clone-like intent, especially short natural requests such as "复刻 https://example.com", "我想复刻 https://example.com", "复刻这个网站 https://example.com", "仿站 https://example.com", "还原 https://example.com", "照着 https://example.com 做一个", "clone https://example.com", "copy https://example.com", "rebuild https://example.com", or "recreate https://example.com". Trigger on Chinese and English wording for 复刻, 仿站, 还原, 照着做, clone, reproduce, copy, rebuild, fork, recreate, or one-to-one webpage implementation. Mirror the source with wget, inspect it with MCP Chrome DevTools, collect Playwright evidence, rebuild the UI, validate screenshots, animations, and interactions, then iterate toward one-to-one visual and behavioral fidelity. Focus on frontend UI and browser-visible behavior; use static fixtures for data.
metadata:
  short-description: One-link webpage cloning
---

# Fork Skill

Goal: a user gives one URL, and the agent drives the full clone pipeline end to end.

Default outcome: the current project contains a working frontend reproduction of the source page with matching layout, assets, typography, responsive behavior, animation timing, and visible interactions.

Natural command examples:

```text
复刻 https://example.com
我想复刻 https://example.com
复刻这个网站 https://example.com
仿站 https://example.com
还原 https://example.com
照着 https://example.com 做一个
clone https://example.com into this project
copy https://example.com
rebuild https://example.com
recreate https://example.com one-to-one
```

## Zero-Input Defaults

When the user gives a clone/reproduction intent plus a URL, proceed with these defaults:

- Source: the provided URL.
- Target route: the current app's primary route, usually `/`.
- Fidelity: evidence-close.
- Viewports: `desktop=1440x900,mobile=390x844`.
- Evidence directory: `.fork-skill/evidence/latest`.
- Report directory: `.fork-skill/reports/latest`.
- Pixel threshold: start at `0.02`, tighten toward `0.01` after major mismatches are fixed.
- Interaction discovery: auto hover/focus probes plus an explicit matrix for visible menus, forms, carousels, modals, media, scrolling, and route changes.

Ask for user action only when credentials, CAPTCHA, paywall access, private content permission, or an irreversible operation is required.

If dependencies are missing, install or request installation in the target project:

```bash
npm install -D playwright pixelmatch pngjs
npx playwright install chromium
brew install wget
```

## Fidelity Definition

Use **evidence-close** as the target:

- Same first viewport composition at desktop and mobile sizes.
- Same full-page section order, spacing, typography, colors, shadows, borders, and image crops.
- Same core responsive breakpoints and overflow behavior.
- Same visible hover, focus, active, click, input, scroll, menu, modal, carousel, and media states.
- Same important animation duration, delay, easing, transform, opacity, and frame progression.
- Same loading, empty, and error states when visible from observed source behavior.
- Same storage/query/fixture-driven UI states when they affect rendering.

Out of scope:

- Rebuilding private backend services, databases, queues, auth systems, payment flows, recommendation logic, or admin workflows.
- Implementing production server logic inferred from network traffic.
- Treat network observations as frontend evidence for assets, visible data shape, loading states, and fixture creation.

## One-Link Pipeline

1. Inspect the target project.
   - Read README, package files, route structure, app entry points, styling setup, and existing components.
   - Identify dev, build, lint, and preview commands.
   - Use the repo's existing framework, package manager, routing, styling, icons, animation libraries, and component conventions.

2. Prepare clone workspace.
   - Create `.fork-skill/`.
   - Store temporary mirrors, evidence, interaction plans, and reports under `.fork-skill/`.
   - Keep final implementation changes in product source files.
   - Prefer one-link initialization:

```bash
node "$HOME/.codex/skills/fork-skill/scripts/one-link-init.mjs" --url https://example.com/
```

   - Read `.fork-skill/runbook.json` for generated local source URL, commands, paths, and viewports.
   - Prefer runbook commands over hand-written paths after initialization.

3. Mirror the source URL.
   - Prefer the bundled mirror script:

```bash
node "$HOME/.codex/skills/fork-skill/scripts/mirror-source.mjs" \
  --url https://example.com/ \
  --out .fork-skill/source
```

   - Use the generated `.fork-skill/source/manifest.json` to find the mirrored entry file.
   - Add required CDN domains when assets are missing:

```bash
node "$HOME/.codex/skills/fork-skill/scripts/mirror-source.mjs" \
  --url https://example.com/ \
  --out .fork-skill/source \
  --domains example.com,cdn.example.com,images.example.com
```

4. Serve the mirrored source.

```bash
python3 -m http.server 4173 --directory .fork-skill/source
```

5. Capture source evidence before coding.
   - Use MCP Chrome DevTools for live inspection.
   - Use the Playwright evidence script for repeatable artifacts:

```bash
node "$HOME/.codex/skills/fork-skill/scripts/capture-evidence.mjs" \
  --source http://127.0.0.1:4173/example.com/index.html \
  --out .fork-skill/evidence/source-pass \
  --viewports desktop=1440x900,mobile=390x844
```

6. Build the interaction matrix.
   - Auto-discovery covers safe hover/focus probes.
   - Create `.fork-skill/interactions.json` for business-critical actions:

```json
[
  {"name":"nav-hover","action":"hover","selector":"nav a:first-child","wait":300},
  {"name":"menu-open","action":"click","selector":"button[aria-label='Menu']","wait":500},
  {"name":"form-fill","action":"fill","selector":"input[type='email']","value":"test@example.com","wait":300},
  {"name":"scroll-middle","action":"scroll","y":800,"wait":500}
]
```

7. Rebuild the page.
   - Copy or recreate licensed local assets from the mirror.
   - Match fonts through local files, existing project font setup, or CSS imports already allowed by the project.
   - Recreate layout from observed element boxes and computed styles.
   - Recreate animations from keyframes, transitions, computed timing, and frame screenshots.
   - Recreate interactions as state machines: trigger, state before, state after, focus movement, storage changes, fixture data changes, and client route changes.
   - Use local static fixtures for visible data when the source depends on remote responses.
   - Use the source page as visual evidence and the local codebase as implementation authority.

8. Run target app and capture paired evidence.

```bash
node "$HOME/.codex/skills/fork-skill/scripts/capture-evidence.mjs" \
  --source http://127.0.0.1:4173/example.com/index.html \
  --target http://127.0.0.1:5173/ \
  --out .fork-skill/evidence/latest \
  --viewports desktop=1440x900,mobile=390x844 \
  --interactions .fork-skill/interactions.json
```

9. Validate, fix, and repeat.

```bash
node "$HOME/.codex/skills/fork-skill/scripts/validate-evidence.mjs" \
  --evidence .fork-skill/evidence/latest \
  --out .fork-skill/reports/latest \
  --threshold 0.02
```

   - Open `.fork-skill/reports/latest/report.md`.
   - Use `Fix Priority`, `Top Screenshot Diffs`, and `Text Drift Samples` sections as the repair queue.
   - Fix the largest visible mismatch first.
   - Repeat capture and validation until the report passes or the remaining delta is documented with a concrete reason.

10. Run project checks.
    - Run available format, lint, typecheck, test, and build commands that match the repo.
    - Keep long-running dev servers alive only when the user needs a live URL.

## DevTools Evidence Checklist

Use MCP Chrome DevTools during source and target comparison:

- `new_page` / `navigate_page`: load mirrored source and local target.
- `resize_page`: test desktop and mobile viewports.
- `take_screenshot`: capture source, target, and key interaction states.
- `take_snapshot`: extract accessible labels, text, headings, controls, and landmarks.
- `evaluate_script`: extract computed styles, boxes, CSS variables, keyframes, animation timing, storage, image dimensions, and scroll metrics.
- `list_network_requests` / `get_network_request`: locate fonts, images, videos, visible fixture data, and missing assets.
- `performance_start_trace` / `performance_stop_trace`: inspect route transitions, loading sequences, layout shifts, input response, and long-running animation timelines.
- `click`, `hover`, `fill`, `fill_form`, `press_key`, `drag`, `wait_for`: execute the same source and target interactions.

## Implementation Rules

- Preserve unrelated user changes.
- Keep `.fork-skill/` artifacts out of committed product source unless the user requests evidence artifacts.
- Use existing project dependencies for animation, gestures, routing, state, CSS, and icons.
- Add focused dependencies only when they directly reproduce observed source behavior.
- Prefer local assets for stability.
- Match display text exactly when it is visible in the source page.
- Preserve accessible names, keyboard focus behavior, and semantic controls when visible interactions depend on them.
- Treat remote data as frontend fixture input: capture visible fields, loading states, empty states, and error states.
- Keep implementation focused on frontend UI; add mock handlers or static JSON only when the visible page needs fixture data.
- Generate `.fork-skill/interactions.json` early and expand it whenever DevTools reveals hidden states.
- Use `sourceSelector` and `targetSelector` in interaction entries when source and target DOM selectors differ.

## Interaction Entry Schema

```json
{
  "name": "menu-open",
  "action": "click",
  "selector": "button[aria-label='Menu']",
  "sourceSelector": "button[aria-label='Menu']",
  "targetSelector": "button[aria-label='Menu']",
  "wait": 500,
  "waitFor": "[role='menu']"
}
```

Supported actions: `hover`, `focus`, `click`, `dblclick`, `fill`, `press`, `scroll`, `drag`, `wait`.

## Acceptance Gate

A clone is ready when:

- `validate-evidence.mjs` passes at `--threshold 0.02` for desktop and mobile base screenshots.
- Key interaction before/after screenshots exist for source and target, and interaction validation passes.
- Major animation sequences have frame captures or DevTools trace evidence.
- Visible source text, primary media, navigation, calls to action, and forms match.
- Project checks pass or any failing check is tied to a pre-existing issue.
- The final response lists source URL, local route, files changed, validation report path, verified viewports, verified interactions, and remaining deltas.

## Final Response Format

Report:

- Source URL.
- Local route or URL.
- Files changed.
- Validation command and report path.
- Viewports verified.
- Interactions verified.
- Remaining deltas with reasons.
- Dev server URL when running.
