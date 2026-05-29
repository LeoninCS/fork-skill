#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    out: ".fork-skill/source",
    domains: "",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    timeout: "30",
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
    "  node scripts/mirror-source.mjs --url <url> [options]",
    "",
    "Options:",
    "  --out <dir>                 Mirror output directory",
    "  --domains <csv>             Allowed domains, defaults to source host",
    "  --user-agent <value>        User agent for wget",
    "  --timeout <seconds>         Network timeout for wget",
  ].join("\n");
}

function inferDomains(urlValue, explicitDomains) {
  if (explicitDomains) {
    return explicitDomains
      .split(",")
      .map((domain) => domain.trim())
      .filter(Boolean);
  }

  const url = new URL(urlValue);
  const host = url.hostname;
  const domains = new Set([host]);
  if (host.startsWith("www.")) {
    domains.add(host.slice(4));
  } else {
    domains.add(`www.${host}`);
  }
  return [...domains];
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
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

function scoreEntry(filePath, sourceUrl, outDir) {
  const url = new URL(sourceUrl);
  const relative = path.relative(outDir, filePath).split(path.sep).join("/");
  let score = 0;
  if (relative.includes(url.hostname)) score += 20;
  if (filePath.endsWith("index.html")) score += 10;
  if (url.pathname && url.pathname !== "/" && relative.includes(url.pathname.replace(/^\/+/, "").replace(/\/+$/, ""))) score += 8;
  if (relative.split("/").length <= 3) score += 3;
  return score;
}

async function findEntries(outDir, sourceUrl) {
  const files = (await walk(outDir)).filter((filePath) => filePath.endsWith(".html"));
  const ranked = files
    .map((filePath) => ({
      filePath,
      relative: path.relative(outDir, filePath).split(path.sep).join("/"),
      score: scoreEntry(filePath, sourceUrl, outDir),
    }))
    .sort((left, right) => right.score - left.score || left.relative.localeCompare(right.relative));
  return ranked;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.url) {
    console.error(usage());
    process.exit(1);
  }

  const sourceUrl = new URL(args.url).href;
  const outDir = path.resolve(args.out);
  const domains = inferDomains(sourceUrl, args.domains);
  await mkdir(outDir, { recursive: true });

  const wgetArgs = [
    "--mirror",
    "--page-requisites",
    "--convert-links",
    "--adjust-extension",
    "--no-parent",
    "--span-hosts",
    "--execute",
    "robots=off",
    "--wait=0.2",
    "--random-wait",
    `--timeout=${args.timeout}`,
    `--user-agent=${args.userAgent}`,
    `--domains=${domains.join(",")}`,
    "--directory-prefix",
    outDir,
    sourceUrl,
  ];

  try {
    await run("wget", wgetArgs);
  } catch (error) {
    throw new Error(
      [
        "wget mirror failed.",
        "Install wget or add required asset domains:",
        "  brew install wget",
        `  node "$FORK_SKILL/scripts/mirror-source.mjs" --url ${sourceUrl} --domains ${domains.join(",")},cdn.example.com`,
        "",
        error.message,
      ].join("\n"),
    );
  }

  const entries = await findEntries(outDir, sourceUrl);
  const outStat = await stat(outDir);
  const manifest = {
    tool: "fork-skill mirror-source",
    mirroredAt: new Date().toISOString(),
    sourceUrl,
    outDir,
    domains,
    entry: entries[0] || null,
    entries: entries.slice(0, 20),
    command: ["wget", ...wgetArgs],
    directoryMtimeMs: outStat.mtimeMs,
  };

  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Mirror written to ${outDir}`);
  if (manifest.entry) {
    console.log(`Best entry: ${manifest.entry.relative}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
