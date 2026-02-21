const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const SCRIPTS_DIR = path.join(__dirname, "scripts");
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || "changeme123"; // CHANGE THIS

// Make sure scripts folder exists
if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─── ALLOWED USER AGENTS (Roblox + popular executors) ────────────────────────
// Checked against the incoming User-Agent header (case-insensitive).
// Add more executor UAs here if needed.
const ALLOWED_UA_PATTERNS = [
  /roblox/i,        // Roblox's built-in HttpGet: "Roblox/WinInet"
  /synapse/i,       // Synapse X
  /script-ware/i,   // Script-Ware
  /scriptware/i,
  /krnl/i,          // KRNL
  /fluxus/i,        // Fluxus
  /oxygen/i,        // Oxygen U
  /evon/i,          // Evon
  /arceus/i,        // Arceus X
  /codex/i,         // Codex
  /delta/i,         // Delta executor
  /wave/i,          // Wave
  /macsploit/i,     // MacSploit
  /sentinel/i,      // Sentinel
];

// ─── GET RAW SCRIPT (this is what loadstring uses) ───────────────────────────
// Usage: loadstring(game:HttpGet("https://yoursite.com/raw/myscript"))()
app.get("/raw/:name", (req, res) => {
  const ua = req.headers["user-agent"] || "";
  const isAllowed = ALLOWED_UA_PATTERNS.some((pattern) => pattern.test(ua));

  if (!isAllowed) {
    // Show a fake generic 404 to anyone browsing with a browser
    return res.status(404).send(`<!DOCTYPE html>
<html><head><title>404 Not Found</title></head>
<body><h1>404 Not Found</h1><p>The requested URL was not found on this server.</p></body>
</html>`);
  }

  const scriptPath = path.join(SCRIPTS_DIR, req.params.name + ".lua");
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).send("-- Script not found");
  }
  res.setHeader("Content-Type", "text/plain");
  res.send(fs.readFileSync(scriptPath, "utf8"));
});

// ─── LIST ALL SCRIPTS (API) ───────────────────────────────────────────────────
app.get("/api/scripts", (req, res) => {
  const files = fs.existsSync(SCRIPTS_DIR)
    ? fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".lua"))
    : [];
  const scripts = files.map((f) => {
    const name = f.replace(".lua", "");
    const stat = fs.statSync(path.join(SCRIPTS_DIR, f));
    const content = fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8");
    return {
      name,
      size: stat.size,
      lines: content.split("\n").length,
      updated: stat.mtime,
    };
  });
  res.json(scripts);
});

// ─── UPLOAD / UPDATE A SCRIPT ─────────────────────────────────────────────────
app.post("/api/upload", (req, res) => {
  const { password, name, content } = req.body;

  if (password !== UPLOAD_PASSWORD) {
    return res.status(401).json({ error: "Wrong password!" });
  }
  if (!name || !content) {
    return res.status(400).json({ error: "Name and content are required." });
  }

  // Sanitize name: only allow letters, numbers, dashes, underscores
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeName) {
    return res.status(400).json({ error: "Invalid script name." });
  }

  const scriptPath = path.join(SCRIPTS_DIR, safeName + ".lua");
  fs.writeFileSync(scriptPath, content, "utf8");

  res.json({ success: true, name: safeName, url: `/raw/${safeName}` });
});

// ─── DELETE A SCRIPT ──────────────────────────────────────────────────────────
app.delete("/api/scripts/:name", (req, res) => {
  const { password } = req.body;

  if (password !== UPLOAD_PASSWORD) {
    return res.status(401).json({ error: "Wrong password!" });
  }

  const scriptPath = path.join(SCRIPTS_DIR, req.params.name + ".lua");
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: "Script not found." });
  }

  fs.unlinkSync(scriptPath);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n🚀 ScriptHost running at http://localhost:${PORT}`);
  console.log(`📜 Raw scripts at: http://localhost:${PORT}/raw/<scriptname>`);
  console.log(`🔑 Upload password: ${UPLOAD_PASSWORD}\n`);
});
