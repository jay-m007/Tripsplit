// Copies the web page and the engine into site/ (what gets published). No bundler, no dependencies.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "web"), out, { recursive: true });
cpSync(join(root, "engine"), join(out, "engine"), { recursive: true });
for (const f of ["index.html", "app.js", "style.css", "engine/index.js"]) {
  if (!existsSync(join(out, f))) { console.error("Build is missing " + f); process.exit(1); }
}
console.log("Built site/ ->", out);
