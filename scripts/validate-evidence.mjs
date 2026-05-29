#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {
    evidence: ".fork-skill/evidence/latest",
    out: ".fork-skill/reports/latest",
    threshold: "0.02",
    soft: "false",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = "true";
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = inlineValue ?? argv[index + 1] ?? "true";
    if (inlineValue === undefined && value !== "true" && String(value).startsWith("--")) {
      throw new Error(`Missing value for --${rawKey}`);
    }

    if (inlineValue === undefined && argv[index + 1]?.startsWith("--") === false) {
      index += 1;
    }

    args[key] = value;
  }

  return args;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/validate-evidence.mjs [options]",
    "",
    "Options:",
    "  --evidence <dir>            Evidence directory",
    "  --out <dir>                 Report output directory",
    "  --threshold <ratio>         Screenshot mismatch ratio threshold",
    "  --soft true                 Write report with successful exit code",
  ].join("\n");
}

async function loadImageTools() {
  const requireFromProject = createRequire(path.join(process.cwd(), "package.json"));
  try {
    const pixelmatchModule = await loadDependency(requireFromProject, "pixelmatch");
    const pngModule = await loadDependency(requireFromProject, "pngjs");
    return {
      pixelmatch: pixelmatchModule.default || pixelmatchModule,
      PNG: pngModule.PNG,
    };
  } catch (error) {
    throw new Error(
      [
        "Image comparison requires pixelmatch and pngjs.",
        "Install them in the target project:",
        "  npm install -D pixelmatch pngjs",
      ].join("\n"),
      { cause: error },
    );
  }
}

async function loadDependency(requireFromProject, name) {
  try {
    return requireFromProject(name);
  } catch (error) {
    try {
      return await import(pathToFileURL(requireFromProject.resolve(name)).href);
    } catch {
      throw error;
    }
  }
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(entryPath));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

function relativeTo(dir, filePath) {
  return path.relative(dir, filePath).split(path.sep).join("/");
}

async function comparePng({ PNG, pixelmatch, sourcePath, targetPath, diffPath }) {
  const source = PNG.sync.read(await readFile(sourcePath));
  const target = PNG.sync.read(await readFile(targetPath));
  const width = Math.max(source.width, target.width);
  const height = Math.max(source.height, target.height);
  const diff = new PNG({ width, height });

  if (source.width !== target.width || source.height !== target.height) {
    return {
      sourcePath,
      targetPath,
      diffPath: "",
      width,
      height,
      pixels: width * height,
      mismatchedPixels: width * height,
      mismatchRatio: 1,
      dimensionMismatch: true,
    };
  }

  const mismatchedPixels = pixelmatch(source.data, target.data, diff.data, source.width, source.height, {
    threshold: 0.1,
    includeAA: true,
  });
  await ensureDir(path.dirname(diffPath));
  await writeFile(diffPath, PNG.sync.write(diff));

  return {
    sourcePath,
    targetPath,
    diffPath,
    width: source.width,
    height: source.height,
    pixels: source.width * source.height,
    mismatchedPixels,
    mismatchRatio: mismatchedPixels / (source.width * source.height),
    dimensionMismatch: false,
  };
}

function textSet(evidence) {
  return new Set(
    (evidence.elements || [])
      .map((element) => String(element.text || "").trim())
      .filter((text) => text.length > 1)
      .map((text) => text.slice(0, 120)),
  );
}

function countBy(list, key) {
  return list.reduce((counts, item) => {
    const value = item[key] || "";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function compareDomStyle(source, target) {
  const sourceTexts = textSet(source);
  const targetTexts = textSet(target);
  const missingTexts = [...sourceTexts].filter((text) => !targetTexts.has(text)).slice(0, 50);
  const extraTexts = [...targetTexts].filter((text) => !sourceTexts.has(text)).slice(0, 50);
  const sourceElements = source.elements || [];
  const targetElements = target.elements || [];

  return {
    sourceTitle: source.title,
    targetTitle: target.title,
    sourceUrl: source.url,
    targetUrl: target.url,
    sourceElementCount: sourceElements.length,
    targetElementCount: targetElements.length,
    elementCountDelta: targetElements.length - sourceElements.length,
    sourceTagCounts: countBy(sourceElements, "tag"),
    targetTagCounts: countBy(targetElements, "tag"),
    missingTexts,
    extraTexts,
    sourceInteractiveCount: (source.interactive || []).length,
    targetInteractiveCount: (target.interactive || []).length,
    sourceAnimationCount: (source.animations || []).length,
    targetAnimationCount: (target.animations || []).length,
    sourceKeyframeCount: (source.keyframes || []).length,
    targetKeyframeCount: (target.keyframes || []).length,
  };
}

async function compareScreenshots(evidenceDir, outDir, threshold) {
  const { PNG, pixelmatch } = await loadImageTools();
  const sourceDir = path.join(evidenceDir, "source");
  const targetDir = path.join(evidenceDir, "target");
  const sourcePngs = (await walk(sourceDir)).filter((filePath) => filePath.endsWith(".png"));
  const results = [];

  for (const sourcePath of sourcePngs) {
    const relPath = relativeTo(sourceDir, sourcePath);
    const targetPath = path.join(targetDir, relPath);
    const diffPath = path.join(outDir, "diffs", relPath);
    try {
      const result = await comparePng({ PNG, pixelmatch, sourcePath, targetPath, diffPath });
      result.relativePath = relPath;
      result.pass = result.mismatchRatio <= threshold && !result.dimensionMismatch;
      results.push(result);
    } catch (error) {
      results.push({
        relativePath: relPath,
        sourcePath,
        targetPath,
        error: error.message,
        pass: false,
      });
    }
  }

  return results;
}

async function compareDomFiles(evidenceDir) {
  const sourceDir = path.join(evidenceDir, "source");
  const targetDir = path.join(evidenceDir, "target");
  const sourceJsons = (await walk(sourceDir)).filter((filePath) => filePath.endsWith("dom-style.json"));
  const results = [];

  for (const sourcePath of sourceJsons) {
    const relPath = relativeTo(sourceDir, sourcePath);
    const targetPath = path.join(targetDir, relPath);
    try {
      results.push({
        relativePath: relPath,
        ...compareDomStyle(await readJson(sourcePath), await readJson(targetPath)),
      });
    } catch (error) {
      results.push({
        relativePath: relPath,
        error: error.message,
      });
    }
  }

  return results;
}

async function compareInteractionFiles(evidenceDir) {
  const sourceDir = path.join(evidenceDir, "source");
  const targetDir = path.join(evidenceDir, "target");
  const sourceJsons = (await walk(sourceDir)).filter((filePath) => filePath.endsWith("interaction-results.json"));
  const results = [];

  for (const sourcePath of sourceJsons) {
    const relPath = relativeTo(sourceDir, sourcePath);
    const targetPath = path.join(targetDir, relPath);
    try {
      const sourceItems = await readJson(sourcePath);
      const targetItems = await readJson(targetPath);
      const targetByName = new Map(targetItems.map((item) => [item.name, item]));
      const rows = sourceItems.map((sourceItem) => {
        const targetItem = targetByName.get(sourceItem.name);
        return {
          name: sourceItem.name,
          action: sourceItem.action,
          sourceOk: Boolean(sourceItem.ok),
          targetOk: Boolean(targetItem?.ok),
          sourceError: sourceItem.error || "",
          targetError: targetItem?.error || "",
          pass: Boolean(sourceItem.ok) && Boolean(targetItem?.ok),
        };
      });
      results.push({
        relativePath: relPath,
        sourceCount: sourceItems.length,
        targetCount: targetItems.length,
        missingTarget: sourceItems.filter((item) => !targetByName.has(item.name)).map((item) => item.name),
        rows,
        pass: rows.every((row) => row.pass) && sourceItems.length === targetItems.length,
      });
    } catch (error) {
      results.push({
        relativePath: relPath,
        error: error.message,
        pass: false,
      });
    }
  }

  return results;
}

function markdownReport(report) {
  const failedScreenshots = report.screenshots
    .filter((item) => !item.pass)
    .slice(0, 10)
    .map((item) => `- ${item.relativePath}: ${(Number(item.mismatchRatio || 0) * 100).toFixed(2)}% mismatch`)
    .join("\n");
  const failedInteractions = report.interactions
    .flatMap((group) => (group.rows || [])
      .filter((row) => !row.pass)
      .map((row) => `- ${group.relativePath}: ${row.name} (${row.action})`))
    .slice(0, 20)
    .join("\n");
  const domIssues = report.dom
    .filter((item) => item.error || (item.missingTexts || []).length || (item.extraTexts || []).length)
    .slice(0, 10)
    .map((item) => `- ${item.relativePath}: missing ${(item.missingTexts || []).length}, extra ${(item.extraTexts || []).length}`)
    .join("\n");
  const screenshotRows = report.screenshots
    .map((item) => {
      const ratio = typeof item.mismatchRatio === "number" ? `${(item.mismatchRatio * 100).toFixed(2)}%` : "error";
      const status = item.pass ? "pass" : "fail";
      return `| ${item.relativePath} | ${status} | ${ratio} | ${item.mismatchedPixels ?? ""} |`;
    })
    .join("\n");
  const domRows = report.dom
    .map((item) => {
      const missing = item.missingTexts?.length ?? "error";
      const extra = item.extraTexts?.length ?? "error";
      return `| ${item.relativePath} | ${item.elementCountDelta ?? ""} | ${missing} | ${extra} | ${item.sourceInteractiveCount ?? ""} -> ${item.targetInteractiveCount ?? ""} |`;
    })
    .join("\n");
  const interactionRows = report.interactions
    .map((item) => {
      const status = item.pass ? "pass" : "fail";
      const failed = item.rows?.filter((row) => !row.pass).length ?? "error";
      return `| ${item.relativePath} | ${status} | ${item.sourceCount ?? ""} -> ${item.targetCount ?? ""} | ${failed} |`;
    })
    .join("\n");
  const topScreenshotDiffs = report.screenshots
    .filter((item) => Number.isFinite(item.mismatchRatio))
    .sort((left, right) => right.mismatchRatio - left.mismatchRatio)
    .slice(0, 8)
    .map((item) => `| ${item.relativePath} | ${(item.mismatchRatio * 100).toFixed(2)}% | ${item.diffPath || ""} |`)
    .join("\n");
  const textIssueRows = report.dom
    .filter((item) => (item.missingTexts || []).length || (item.extraTexts || []).length)
    .slice(0, 8)
    .map((item) => `| ${item.relativePath} | ${(item.missingTexts || []).slice(0, 3).join("<br>")} | ${(item.extraTexts || []).slice(0, 3).join("<br>")} |`)
    .join("\n");

  return [
    "# Fork Skill Evidence Report",
    "",
    `Status: ${report.pass ? "pass" : "fail"}`,
    `Threshold: ${(report.threshold * 100).toFixed(2)}%`,
    "",
    "## Fix Priority",
    "",
    failedScreenshots || "- Screenshots pass",
    failedInteractions || "- Interactions pass",
    domIssues || "- DOM/style checks have no reported text issues",
    "",
    "## Top Screenshot Diffs",
    "",
    "| File | Mismatch | Diff Image |",
    "| --- | ---: | --- |",
    topScreenshotDiffs || "| No screenshot diffs | 0.00% | |",
    "",
    "## Text Drift Samples",
    "",
    "| File | Missing Source Text | Extra Target Text |",
    "| --- | --- | --- |",
    textIssueRows || "| No text drift |  |  |",
    "",
    "## Screenshots",
    "",
    "| File | Status | Mismatch | Pixels |",
    "| --- | --- | ---: | ---: |",
    screenshotRows || "| No screenshots | fail | error | |",
    "",
    "## DOM And Style",
    "",
    "| File | Element Delta | Missing Texts | Extra Texts | Interactive |",
    "| --- | ---: | ---: | ---: | --- |",
    domRows || "| No DOM evidence |  |  |  |  |",
    "",
    "## Interactions",
    "",
    "| File | Status | Count | Failed |",
    "| --- | --- | --- | ---: |",
    interactionRows || "| No interaction evidence | fail |  |  |",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    console.log(usage());
    return;
  }
  const evidenceDir = path.resolve(args.evidence);
  const outDir = path.resolve(args.out);
  const threshold = Number(args.threshold);
  await ensureDir(outDir);

  const screenshots = await compareScreenshots(evidenceDir, outDir, threshold);
  const dom = await compareDomFiles(evidenceDir);
  const interactions = await compareInteractionFiles(evidenceDir);
  const pass = screenshots.length > 0
    && screenshots.every((item) => item.pass)
    && dom.every((item) => !item.error)
    && interactions.length > 0
    && interactions.every((item) => item.pass);
  const report = {
    tool: "fork-skill validate-evidence",
    validatedAt: new Date().toISOString(),
    evidenceDir,
    outDir,
    threshold,
    pass,
    screenshots,
    dom,
    interactions,
  };

  await writeJson(path.join(outDir, "report.json"), report);
  await writeFile(path.join(outDir, "report.md"), markdownReport(report));
  console.log(`Report written to ${outDir}`);
  if (!pass && args.soft !== "true") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
