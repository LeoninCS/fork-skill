#!/usr/bin/env node

import { lstat, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");
const skillsDir = path.join(os.homedir(), ".codex", "skills");
const linkPath = path.join(skillsDir, "fork-skill");

async function removeExistingLink() {
  try {
    const existing = await lstat(linkPath);
    if (existing.isSymbolicLink()) {
      await rm(linkPath);
      return;
    }
    throw new Error(`${linkPath} already exists and is not a symlink`);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function main() {
  await mkdir(skillsDir, { recursive: true });
  await removeExistingLink();
  await symlink(skillRoot, linkPath, "dir");

  console.log(`Installed fork-skill at ${linkPath}`);
  console.log("");
  console.log("Try it:");
  console.log(`node "${linkPath}/scripts/one-link-init.mjs" --url https://example.com/`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
