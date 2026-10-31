// Tiny static server for trying the site locally: npm run serve, then open http://localhost:8080
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const port = Number(process.env.PORT || 8080);
createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = join(site, p);
  if (!file.startsWith(site) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, () => console.log("Open http://localhost:" + port));
