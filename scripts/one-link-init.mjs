#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    out: ".fork-skill",
    mirrorOut: ".fork-skill/source",
    sourcePort: "4173",
    targetPort: "5173",
    viewports: "desktop=1440x900,mobile=390x844",
    domains: "",
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
    "  node scripts/one-link-init.mjs --url <url> [options]",
    "",
    "Options:",
    "  --out <dir>                 Workspace directory",
    "  --mirror-out <dir>          Mirror output directory",
    "  --domains <csv>             Allowed mirror domains",
    "  --source-port <number>      Suggested mirror server port",
    "  --target-port <number>      Suggested target app port",
    "  --viewports <list>          Capture viewport list",
  ].join("\n");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function localEntryUrl(port, relativePath) {
  return `http://127.0.0.1:${port}/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

  await mkdir(args.out, { recursive: true });
  const forkSkill = process.env.FORK_SKILL || DEFAULT_SKILL_ROOT;
  const forkSkillCapture = shellQuote(path.join(forkSkill, "scripts/capture-evidence.mjs"));
  const forkSkillValidate = shellQuote(path.join(forkSkill, "scripts/validate-evidence.mjs"));
  const mirrorArgs = [
    path.join(forkSkill, "scripts/mirror-source.mjs"),
    "--url",
    args.url,
    "--out",
    args.mirrorOut,
  ];
  if (args.domains) {
    mirrorArgs.push("--domains", args.domains);
  }

  await run("node", mirrorArgs);

  const manifest = JSON.parse(await readFile(path.join(args.mirrorOut, "manifest.json"), "utf8"));
  const entryRelative = manifest.entry?.relative || "";
  const sourceLocalUrl = entryRelative ? localEntryUrl(args.sourcePort, entryRelative) : "";
  const interactionsPath = path.join(args.out, "interactions.json");
  const runbook = {
    sourceUrl: new URL(args.url).href,
    sourcePort: Number(args.sourcePort),
    targetPort: Number(args.targetPort),
    viewports: args.viewports,
    mirrorOut: args.mirrorOut,
    sourceLocalUrl,
    interactionsPath,
    evidenceDir: path.join(args.out, "evidence/latest"),
    reportDir: path.join(args.out, "reports/latest"),
    serveSourceCommand: `python3 -m http.server ${args.sourcePort} --directory ${shellQuote(args.mirrorOut)}`,
    captureSourceCommand: sourceLocalUrl
      ? `node ${forkSkillCapture} --source ${sourceLocalUrl} --out ${shellQuote(`${args.out}/evidence/source-pass`)} --viewports ${shellQuote(args.viewports)}`
      : "",
    capturePairCommand: sourceLocalUrl
      ? `node ${forkSkillCapture} --source ${sourceLocalUrl} --target http://127.0.0.1:${args.targetPort}/ --out ${shellQuote(`${args.out}/evidence/latest`)} --viewports ${shellQuote(args.viewports)} --interactions ${shellQuote(interactionsPath)}`
      : "",
    validateCommand: `node ${forkSkillValidate} --evidence ${shellQuote(`${args.out}/evidence/latest`)} --out ${shellQuote(`${args.out}/reports/latest`)} --threshold 0.02`,
  };

  await writeJson(interactionsPath, [
    { name: "scroll-middle", action: "scroll", y: 800, wait: 500 },
    { name: "scroll-bottom", action: "scroll", y: 1600, wait: 500 },
  ]);
  await writeJson(path.join(args.out, "runbook.json"), runbook);

  console.log(`Runbook written to ${path.join(args.out, "runbook.json")}`);
  if (sourceLocalUrl) {
    console.log(`Source local URL: ${sourceLocalUrl}`);
  }
  console.log(runbook.serveSourceCommand);
  if (runbook.captureSourceCommand) {
    console.log(runbook.captureSourceCommand);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
