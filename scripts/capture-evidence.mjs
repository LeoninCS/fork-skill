#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_VIEWPORTS = "desktop=1440x900,mobile=390x844";
const DEFAULT_FRAMES = [0, 0.25, 0.5, 0.75, 1];

function parseArgs(argv) {
  const args = {
    out: ".fork-skill/evidence/latest",
    viewports: DEFAULT_VIEWPORTS,
    interactions: "",
    autoLimit: 8,
    timeout: 30000,
    settle: 800,
    frames: DEFAULT_FRAMES.join(","),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || String(value).startsWith("--")) {
      throw new Error(`Missing value for --${rawKey}`);
    }

    if (inlineValue === undefined) {
      index += 1;
    }

    args[key] = value;
  }

  return args;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/capture-evidence.mjs --source <url> [--target <url>] [options]",
    "",
    "Options:",
    "  --source <url>                    Source page URL or local file path",
    "  --target <url>                    Target page URL or local file path",
    "  --out <dir>                       Evidence output directory",
    "  --viewports desktop=1440x900,mobile=390x844",
    "  --interactions <json>             Interaction matrix file",
    "  --auto-limit <number>             Safe hover/focus probes per viewport",
    "  --timeout <ms>                    Navigation timeout",
    "  --settle <ms>                     Extra wait after load",
    "  --frames 0,0.25,0.5,0.75,1       Animation frame percentages",
  ].join("\n");
}

async function loadPlaywright() {
  const requireFromProject = createRequire(path.join(process.cwd(), "package.json"));
  try {
    return requireFromProject("playwright");
  } catch (error) {
    try {
      return await import(pathToFileURL(requireFromProject.resolve("playwright")).href);
    } catch {
      throw new Error(
        [
          "Playwright is required.",
          "Install it in the target project:",
          "  npm install -D playwright",
          "  npx playwright install chromium",
        ].join("\n"),
        { cause: error },
      );
    }
  }
}

function parseViewports(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, size] = entry.includes("=") ? entry.split("=", 2) : ["viewport", entry];
      const [width, height] = size.split("x").map((part) => Number.parseInt(part, 10));
      if (!name || !Number.isFinite(width) || !Number.isFinite(height)) {
        throw new Error(`Invalid viewport: ${entry}`);
      }
      return { name, width, height };
    });
}

function normalizeUrl(input) {
  if (!input) {
    return "";
  }

  if (/^https?:\/\//i.test(input) || /^file:\/\//i.test(input)) {
    return input;
  }

  return pathToFileURL(path.resolve(input)).href;
}

async function readInteractions(filePath) {
  if (!filePath) {
    return [];
  }

  const interactions = JSON.parse(await readFile(filePath, "utf8"));

  if (!Array.isArray(interactions)) {
    throw new Error("Interaction file must contain a JSON array.");
  }

  return interactions.map((interaction, index) => ({
    name: interaction.name || `interaction-${String(index + 1).padStart(2, "0")}`,
    wait: 300,
    ...interaction,
  }));
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

async function settlePage(page, extraWait) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts?.ready?.catch?.(() => {});
    await Promise.all(
      [...document.images].map((image) => {
        if (image.complete) {
          return undefined;
        }
        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }),
    );
  }).catch(() => {});
  await page.waitForTimeout(Number(extraWait) || 0);
}

async function collectEvidence(page, viewport) {
  return page.evaluate((viewportInfo) => {
    const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x * 100) / 100,
        y: Math.round(rect.y * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        bottom: Math.round(rect.bottom * 100) / 100,
      };
    };
    const selectorOf = (element) => {
      if (element.id) {
        return `#${CSS.escape(element.id)}`;
      }

      const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
      if (testId) {
        return `[data-testid="${CSS.escape(testId)}"]`;
      }

      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        const classNames = String(current.className || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3);
        if (classNames.length) {
          part += `.${classNames.map((name) => CSS.escape(name)).join(".")}`;
        }

        const parent = current.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) {
            part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
        }

        parts.unshift(part);
        current = parent;
      }
      return parts.join(" > ");
    };
    const computedSubset = (element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        position: style.position,
        zIndex: style.zIndex,
        opacity: style.opacity,
        color: style.color,
        backgroundColor: style.backgroundColor,
        font: style.font,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textAlign: style.textAlign,
        margin: style.margin,
        padding: style.padding,
        border: style.border,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        transform: style.transform,
        filter: style.filter,
        transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration,
        transitionDelay: style.transitionDelay,
        transitionTimingFunction: style.transitionTimingFunction,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        animationDelay: style.animationDelay,
        animationTimingFunction: style.animationTimingFunction,
        animationIterationCount: style.animationIterationCount,
      };
    };
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const rootStyle = getComputedStyle(document.documentElement);
    const cssVariables = [...rootStyle]
      .filter((name) => name.startsWith("--"))
      .sort()
      .reduce((vars, name) => {
        vars[name] = rootStyle.getPropertyValue(name).trim();
        return vars;
      }, {});
    const keyframes = [...document.styleSheets].flatMap((sheet) => {
      try {
        return [...sheet.cssRules]
          .filter((rule) => rule.type === CSSRule.KEYFRAMES_RULE)
          .map((rule) => ({ name: rule.name, cssText: rule.cssText }));
      } catch {
        return [];
      }
    });
    const elements = [...document.querySelectorAll("body *")]
      .filter(isVisible)
      .slice(0, 500)
      .map((element) => {
        const text = cleanText(element.textContent).slice(0, 160);
        const role = element.getAttribute("role") || "";
        return {
          tag: element.tagName.toLowerCase(),
          selector: selectorOf(element),
          signature: `${element.tagName.toLowerCase()}|${role}|${text.slice(0, 80)}`,
          role,
          ariaLabel: element.getAttribute("aria-label") || "",
          text,
          href: element.getAttribute("href") || "",
          type: element.getAttribute("type") || "",
          rect: rectOf(element),
          style: computedSubset(element),
        };
      });
    const interactive = [...document.querySelectorAll("a,button,input,select,textarea,[role='button'],[tabindex]")]
      .filter(isVisible)
      .slice(0, 120)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        selector: selectorOf(element),
        text: cleanText(element.textContent || element.getAttribute("value") || element.getAttribute("aria-label")),
        role: element.getAttribute("role") || "",
        rect: rectOf(element),
        disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
      }));
    const media = {
      images: [...document.images].map((image) => ({
        selector: selectorOf(image),
        src: image.currentSrc || image.src,
        alt: image.alt,
        rect: rectOf(image),
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      })),
      videos: [...document.querySelectorAll("video")].map((video) => ({
        selector: selectorOf(video),
        src: video.currentSrc || video.src,
        poster: video.poster,
        rect: rectOf(video),
        width: video.videoWidth,
        height: video.videoHeight,
        autoplay: video.autoplay,
        muted: video.muted,
        loop: video.loop,
      })),
    };
    const animations = document.getAnimations({ subtree: true }).map((animation) => {
      const target = animation.effect?.target;
      const timing = animation.effect?.getComputedTiming?.();
      return {
        selector: target ? selectorOf(target) : "",
        playState: animation.playState,
        currentTime: animation.currentTime,
        playbackRate: animation.playbackRate,
        timing,
      };
    });

    return {
      capturedAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      viewport: viewportInfo,
      document: {
        lang: document.documentElement.lang || "",
        dir: document.documentElement.dir || "",
        bodyClass: document.body.className,
        scroll: { x: scrollX, y: scrollY },
        size: {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        },
      },
      meta: [...document.querySelectorAll("meta")].map((meta) => ({
        name: meta.getAttribute("name") || meta.getAttribute("property") || "",
        content: meta.getAttribute("content") || "",
      })),
      storage: {
        cookies: document.cookie,
        localStorage: Object.fromEntries(Object.entries(localStorage)),
        sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
      },
      cssVariables,
      keyframes,
      animations,
      elements,
      interactive,
      media,
    };
  }, viewport);
}

async function captureAnimationFrames(page, dir, frameValues) {
  const animationCount = await page.evaluate(() => document.getAnimations({ subtree: true }).length).catch(() => 0);
  if (!animationCount) {
    return [];
  }

  await ensureDir(dir);
  const frames = [];
  for (const frame of frameValues) {
    await page.evaluate((progress) => {
      for (const animation of document.getAnimations({ subtree: true })) {
        const timing = animation.effect?.getComputedTiming?.();
        const duration = Number.isFinite(timing?.activeDuration) && timing.activeDuration > 0
          ? timing.activeDuration
          : Number.isFinite(timing?.duration) && timing.duration > 0
            ? timing.duration
            : 1000;
        animation.pause();
        animation.currentTime = Math.max(0, Math.min(duration, duration * progress));
      }
    }, frame).catch(() => {});
    await page.waitForTimeout(80);
    const filePath = path.join(dir, `animation-${String(Math.round(frame * 100)).padStart(3, "0")}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    frames.push({ progress: frame, file: filePath });
  }
  return frames;
}

async function capturePage({
  browser,
  label,
  url,
  viewport,
  outDir,
  timeout,
  settle,
  frameValues,
  interactions,
  autoLimit,
  autoInteractions,
}) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const network = [];

  page.on("response", async (response) => {
    const request = response.request();
    network.push({
      url: response.url(),
      status: response.status(),
      method: request.method(),
      resourceType: request.resourceType(),
      contentType: response.headers()["content-type"] || "",
    });
  });

  const baseDir = path.join(outDir, label, viewport.name);
  await ensureDir(baseDir);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: Number(timeout) });
  await settlePage(page, settle);
  await page.screenshot({ path: path.join(baseDir, "viewport.png"), fullPage: false });
  await page.screenshot({ path: path.join(baseDir, "fullpage.png"), fullPage: true });
  await writeJson(path.join(baseDir, "dom-style.json"), await collectEvidence(page, viewport));
  await writeJson(path.join(baseDir, "network.json"), network);
  const frames = await captureAnimationFrames(page, path.join(baseDir, "frames"), frameValues);
  await writeJson(path.join(baseDir, "animation-frames.json"), frames);

  const safeAuto = autoInteractions ?? await page.evaluate((limit) => {
    const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const attrEscape = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const selectorOf = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const label = element.getAttribute("aria-label");
      if (label) return `${element.tagName.toLowerCase()}[aria-label="${attrEscape(label)}"]`;
      const href = element.getAttribute("href");
      if (href && element.tagName === "A") return `a[href="${attrEscape(href)}"]`;
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        const siblings = parent ? [...parent.children].filter((child) => child.tagName === current.tagName) : [];
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
        parts.unshift(`${tag}${nth}`);
        current = parent;
      }
      return parts.join(" > ");
    };
    return [...document.querySelectorAll("a,button,input,select,textarea,[role='button'],[tabindex]")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .slice(0, limit)
      .flatMap((element, index) => {
        const info = selectorOf(element);
        return [
          { name: `auto-${index + 1}-hover`, action: "hover", selector: info, wait: 250 },
          { name: `auto-${index + 1}-focus`, action: "focus", selector: info, wait: 250 },
        ];
      });
  }, Number(autoLimit) || 0).catch(() => []);

  await page.close();

  const allInteractions = [...safeAuto, ...interactions];
  const interactionResults = [];
  for (const interaction of allInteractions) {
    interactionResults.push(
      await runInteraction({
        browser,
        url,
        label,
        viewport,
        outDir,
        timeout,
        settle,
        interaction,
      }),
    );
  }
  await writeJson(path.join(baseDir, "interaction-results.json"), interactionResults);

  return {
    label,
    url,
    viewport,
    baseDir,
    screenshots: ["viewport.png", "fullpage.png"],
    interactions: interactionResults.length,
    generatedInteractions: safeAuto,
  };
}

async function runInteraction({ browser, url, label, viewport, outDir, timeout, settle, interaction }) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const name = slug(interaction.name);
  const dir = path.join(outDir, label, viewport.name, "interactions", name);
  await ensureDir(dir);

  const result = {
    name,
    action: interaction.action,
    selector: selectorForLabel(interaction, label),
    ok: true,
    error: "",
  };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Number(timeout) });
    await settlePage(page, settle);
    await page.screenshot({ path: path.join(dir, "before.png"), fullPage: true });
    await writeJson(path.join(dir, "before.json"), await collectEvidence(page, viewport));
    await performInteraction(page, interaction, label);
    if (interaction.waitFor) {
      await page.waitForSelector(interaction.waitFor, { timeout: Number(interaction.waitForTimeout || 5000) });
    }
    await page.waitForTimeout(Number(interaction.wait) || 0);
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    await page.screenshot({ path: path.join(dir, "after.png"), fullPage: true });
    await writeJson(path.join(dir, "after.json"), await collectEvidence(page, viewport));
  } catch (error) {
    result.ok = false;
    result.error = error.message;
  } finally {
    await page.close();
  }

  await writeJson(path.join(dir, "result.json"), result);
  return result;
}

function selectorForLabel(interaction, label) {
  if (label === "source" && interaction.sourceSelector) {
    return interaction.sourceSelector;
  }
  if (label === "target" && interaction.targetSelector) {
    return interaction.targetSelector;
  }
  return interaction.selector || "";
}

async function performInteraction(page, interaction, label) {
  const action = interaction.action;
  const selector = selectorForLabel(interaction, label);

  if (action === "hover") {
    await page.hover(selector);
    return;
  }
  if (action === "focus") {
    await page.locator(selector).focus();
    return;
  }
  if (action === "click") {
    await page.click(selector);
    return;
  }
  if (action === "dblclick") {
    await page.dblclick(selector);
    return;
  }
  if (action === "fill") {
    await page.fill(selector, String(interaction.value ?? ""));
    return;
  }
  if (action === "press") {
    await page.press(selector || "body", interaction.key || "Enter");
    return;
  }
  if (action === "scroll") {
    await page.evaluate(({ x, y }) => window.scrollTo(Number(x) || 0, Number(y) || 0), interaction);
    return;
  }
  if (action === "drag") {
    const target = label === "source" && interaction.sourceTarget
      ? interaction.sourceTarget
      : label === "target" && interaction.targetTarget
        ? interaction.targetTarget
        : interaction.target;
    await page.dragAndDrop(selector, target);
    return;
  }
  if (action === "wait") {
    await page.waitForTimeout(Number(interaction.wait) || 300);
    return;
  }

  throw new Error(`Unsupported interaction action: ${action}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const source = normalizeUrl(args.source);
  const target = normalizeUrl(args.target);

  if (!source && !target) {
    console.error(usage());
    process.exit(1);
  }

  const { chromium } = await loadPlaywright();
  const viewports = parseViewports(args.viewports);
  const interactions = await readInteractions(args.interactions);
  const frameValues = String(args.frames)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  const outDir = path.resolve(args.out);
  await ensureDir(outDir);

  const browser = await chromium.launch();
  const manifest = {
    tool: "fork-skill capture-evidence",
    capturedAt: new Date().toISOString(),
    source,
    target,
    outDir,
    viewports,
    interactions: interactions.length,
    captures: [],
  };

  try {
    for (const viewport of viewports) {
      let generatedInteractions = [];
      if (source) {
        const sourceCapture = await capturePage({
          browser,
          label: "source",
          url: source,
          viewport,
          outDir,
          timeout: args.timeout,
          settle: args.settle,
          frameValues,
          interactions,
          autoLimit: args.autoLimit,
        });
        generatedInteractions = sourceCapture.generatedInteractions || [];
        manifest.captures.push(sourceCapture);
      }
      if (target) {
        manifest.captures.push(
          await capturePage({
            browser,
            label: "target",
            url: target,
            viewport,
            outDir,
            timeout: args.timeout,
            settle: args.settle,
            frameValues,
            interactions,
            autoLimit: args.autoLimit,
            autoInteractions: source ? generatedInteractions : undefined,
          }),
        );
      }
    }
  } finally {
    await browser.close();
  }

  await writeJson(path.join(outDir, "manifest.json"), manifest);
  console.log(`Evidence written to ${outDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
