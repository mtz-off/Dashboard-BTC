// Petit serveur statique local (aucune dépendance) pour visualiser le dashboard:
// sert /site à la racine et /data/state.json tel quel, pour reproduire le layout de prod.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  let urlPath = req.url.split("?")[0];
  let filePath;
  if (urlPath.startsWith("/data/")) {
    filePath = path.join(__dirname, urlPath);
  } else {
    if (urlPath === "/") urlPath = "/index.html";
    filePath = path.join(__dirname, "site", urlPath);
  }
  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
