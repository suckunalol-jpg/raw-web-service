const express = require("express");
const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");
const { v4: uuidv4 } = require("uuid");

const app  = express();
const PORT = process.env.PORT || 3000;
const SCRIPTS_DIR     = path.join(__dirname, "scripts");
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || "spaxisgay";

app.set("trust proxy", 1);
if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ══════════════════════════════════════════════════════════════════════════════
//  STATIC FILES — MUST come BEFORE honeypots so index.html actually loads
// ══════════════════════════════════════════════════════════════════════════════
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// ══════════════════════════════════════════════════════════════════════════════
//  LAYER 1 — UA WHITELIST / BROWSER BLOCKLIST
// ══════════════════════════════════════════════════════════════════════════════
const ALLOWED_UA = [
  "Roblox/WinInet","RobloxStudio","ROBLOX/",
  "Synapse/","SynapseX","KRNL/","Krnl/",
  "fluxus","Fluxus","Script-Ware","scriptware",
  "Oxygen U","OxygenU","Evon/","Delta/","Wave/",
  "Arceus X","ArceusX","Codex/","Sentinel/","MacSploit","Electron/",
];
const BROWSER_POISON = [
  "Mozilla/5.0","AppleWebKit","Gecko/","Chrome/","Safari/",
  "Firefox/","OPR/","Trident/","Edge/","Edg/",
  "curl/","wget/","python-requests","axios/","node-fetch",
  "PostmanRuntime","insomnia","HTTPie","Go-http-client","Java/","libwww-perl",
];
function validateUA(ua) {
  if (!ua || ua.length < 4) return false;
  if (!ALLOWED_UA.some(s => ua.includes(s))) return false;
  if (BROWSER_POISON.some(s => ua.includes(s))) return false;
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
//  LAYER 2 — RATE LIMITING
// ══════════════════════════════════════════════════════════════════════════════
const rateStore = new Map();
const RATE_WINDOW = 60_000, RATE_MAX = 20;
function checkRate(ip) {
  const now = Date.now();
  let e = rateStore.get(ip);
  if (!e || now - e.t > RATE_WINDOW) e = { count: 1, t: now };
  else e.count++;
  rateStore.set(ip, e);
  return e.count <= RATE_MAX;
}

// ══════════════════════════════════════════════════════════════════════════════
//  LAYER 3 — HONEYPOT
// ══════════════════════════════════════════════════════════════════════════════
const banned = new Set();
function fake404(res) {
  return res.status(404).send("<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>");
}
["scripts","script","lua","raw","src","source","get","files"].forEach(p => {
  app.get(`/${p}/:x`, (req, res) => { banned.add(req.ip); return fake404(res); });
});

// ══════════════════════════════════════════════════════════════════════════════
//  LAYER 4 — KEY SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
const KEYS_FILE = path.join(__dirname, "keys.json");
function readKeys()  { try { return JSON.parse(fs.readFileSync(KEYS_FILE,"utf8")); } catch { return {}; } }
function writeKeys(d){ fs.writeFileSync(KEYS_FILE, JSON.stringify(d,null,2)); }

function validateKey(keyStr, hwid) {
  const keys = readKeys();
  const k    = keys[keyStr];
  if (!k)            return { ok: false, code: "KEY_INVALID" };
  if (!k.active)     return { ok: false, code: "KEY_REVOKED" };
  if (Date.now() > k.expires) return { ok: false, code: "KEY_EXPIRED" };
  if (k.maxUses && k.uses >= k.maxUses) return { ok: false, code: "KEY_USED" };
  if (!k.hwid) {
    k.hwid  = hwid;
    k.uses  = (k.uses || 0) + 1;
    keys[keyStr] = k;
    writeKeys(keys);
    return { ok: true, bound: true };
  }
  if (k.hwid !== hwid) return { ok: false, code: "KEY_HWID_MISMATCH" };
  k.uses = (k.uses || 0) + 1;
  keys[keyStr] = k;
  writeKeys(keys);
  return { ok: true, bound: false };
}

// ══════════════════════════════════════════════════════════════════════════════
//  LAYER 5 — ONE-TIME SESSION TOKENS (30s TTL)
// ══════════════════════════════════════════════════════════════════════════════
const tokens = new Map();
const TOKEN_TTL = 30_000;
function mintToken(scriptName, hwid, ip) {
  const t = crypto.randomBytes(48).toString("hex");
  tokens.set(t, { scriptName, hwid, ip, born: Date.now(), used: false });
  setTimeout(() => tokens.delete(t), TOKEN_TTL + 5000);
  return t;
}
function burnToken(t, hwid, ip) {
  const e = tokens.get(t);
  if (!e)              return { ok: false, reason: "invalid_token" };
  if (e.used)          return { ok: false, reason: "token_already_used" };
  if (Date.now() - e.born > TOKEN_TTL) { tokens.delete(t); return { ok: false, reason: "token_expired" }; }
  if (e.hwid !== hwid) return { ok: false, reason: "hwid_mismatch" };
  const sub = x => x.split(".").slice(0,3).join(".");
  if (sub(e.ip) !== sub(ip)) console.warn(`[SUBNET WARN] token=${e.ip} req=${ip}`);
  e.used = true;
  tokens.delete(t);
  return { ok: true, scriptName: e.scriptName };
}

// ══════════════════════════════════════════════════════════════════════════════
//  LAYER 6 — OBFUSCATION + ANTI-DUMP ENGINE
// ══════════════════════════════════════════════════════════════════════════════
function r4() { return "_" + crypto.randomBytes(4).toString("hex"); }
function encStr(s) { return "string.char(" + Array.from(s).map(c=>c.charCodeAt(0)).join(",") + ")"; }
function xorEncode(src, key) {
  const out = [];
  for (let i = 0; i < src.length; i++) out.push(src.charCodeAt(i) ^ key);
  return out;
}

function buildPayload(src, hwid, scriptName) {
  const key   = (Math.floor(Math.random() * 180) + 30) | 0;
  const enc   = xorEncode(src, key);
  const chunkSize = 120;
  const chunks = [];
  for (let i = 0; i < enc.length; i += chunkSize) {
    chunks.push("{" + enc.slice(i, i + chunkSize).join(",") + "}");
  }
  const chunkVars = chunks.map((c) => { const v = r4(); return { v, def: `local ${v}=${c}` }; });
  const [vK,vH,vD,vF,vG,vT,vC,vR,vB,vN] = Array.from({length:10}, r4);
  const eHWID = encStr(hwid);
  const joinExpr = chunkVars.map(cv => cv.v).join(",");

  return `-- PubArmour Protected
local ${vT}=tick
local ${vC}=string.char
local ${vR}=table.concat
local ${vB}=math.floor
local ${vG}=loadstring or load
local ${vK}=${key}
local ${vH}=${eHWID}
local ${vN}=game and game.GetService
if not ${vN} then error("ctx",2) end
local _t0=${vT}()
${chunkVars.map(cv=>cv.def).join("\n")}
local ${vD}={}
local _ci,_di=1,1
local _chunks={${joinExpr}}
for _,_ch in ipairs(_chunks) do
  for _j=1,#_ch do ${vD}[_di]=${vC}(${vB}(_ch[_j])~${vK}) _di=_di+1 end
end
local _t1=${vT}()
if (_t1-_t0)>3 then
  load(${encStr("pcall(function()game:GetService('TeleportService'):Teleport(0)end)")})()
  error(${encStr("[PubArmour] Timing violation.")},2) return
end
if type(${vG})~="function" or type(${vG}("return 1"))~="function" then
  load(${encStr("pcall(function()game:GetService('TeleportService'):Teleport(0)end)")})()
  error(${encStr("[PubArmour] Integrity check failed.")},2) return
end
local _hw,_hok
_hok=pcall(function() _hw=tostring(game:GetService("RbxAnalyticsService"):GetClientId()) end)
if not _hok or not _hw or _hw=="" then
  _hw=tostring(game:GetService("Players").LocalPlayer.UserId)
end
if _hw~=${vH} then
  load(${encStr("pcall(function()game:GetService('TeleportService'):Teleport(0)end)")})()
  error(${encStr("[PubArmour] HWID mismatch.")},2) return
end
local ${vF}=${vR}(${vD})
local _fn,_er=${vG}(${vF})
if not _fn then
  load(${encStr("pcall(function()game:GetService('TeleportService'):Teleport(0)end)")})()
  error(tostring(_er),2)
end
return _fn()`.trim();
}

function buildRawPayload(src, hwid) {
  const [vH, vN, vHW, vOK] = Array.from({length:4}, r4);
  const eHWID = encStr(hwid);
  return `-- PubArmour Protected (pre-obfuscated)
local ${vN}=game and game.GetService
if not ${vN} then error("ctx",2) end
local ${vH}=${eHWID}
local ${vHW},${vOK}
${vOK}=pcall(function() ${vHW}=tostring(game:GetService("RbxAnalyticsService"):GetClientId()) end)
if not ${vOK} or not ${vHW} or ${vHW}=="" then
  ${vHW}=tostring(game:GetService("Players").LocalPlayer.UserId)
end
if ${vHW}~=${vH} then
  load(${encStr("pcall(function()game:GetService('TeleportService'):Teleport(0)end)")})()
  error(${encStr("[PubArmour] HWID mismatch.")},2) return
end
${src}`.trim();
}

function kickResponse(code) {
  const msgs = {
    KEY_INVALID:       "Invalid key.",
    KEY_REVOKED:       "Your key has been revoked.",
    KEY_EXPIRED:       "Your key has expired.",
    KEY_USED:          "Key usage limit reached.",
    KEY_HWID_MISMATCH: "Key is locked to a different device.",
  };
  const msg  = msgs[code] || "Access denied.";
  const kick = encStr("pcall(function()game:GetService('TeleportService'):Teleport(0)end)");
  const err  = encStr("[PubArmour] " + msg);
  return `load(${kick})();error(${err},2)`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  DATA HELPERS
// ══════════════════════════════════════════════════════════════════════════════
const META_FILE = path.join(__dirname, "meta.json");
function readMeta()  { try { return JSON.parse(fs.readFileSync(META_FILE,"utf8")); } catch { return {}; } }
function writeMeta(d){ fs.writeFileSync(META_FILE, JSON.stringify(d,null,2)); }

function checkCommon(req, res) {
  const ip = req.ip;
  if (banned.has(ip))                              { fake404(res); return false; }
  if (!checkRate(ip))                              { res.status(429).send("-- rate_limited"); return false; }
  if (!validateUA(req.headers["user-agent"]||"")) { fake404(res); return false; }
  const hwid = req.headers["x-hwid"];
  if (!hwid || hwid.length < 6)                   { res.status(403).send("-- missing_hwid"); return false; }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC ENDPOINTS (executor-facing)
// ══════════════════════════════════════════════════════════════════════════════

app.get("/auth/:name", (req, res) => {
  if (!checkCommon(req, res)) return;

  const hwid   = req.headers["x-hwid"];
  const keyStr = req.query.key;
  const ip     = req.ip;
  const name   = (req.params.name||"").replace(/[^a-zA-Z0-9_-]/g,"");

  res.setHeader("Content-Type","text/plain");
  res.setHeader("Cache-Control","no-store");

  if (!keyStr) return res.status(403).send(kickResponse("KEY_INVALID"));

  const kv = validateKey(keyStr, hwid);
  if (!kv.ok) {
    console.warn(`[KEY FAIL] ${kv.code} key=${keyStr} ip=${ip}`);
    return res.status(403).send(kickResponse(kv.code));
  }

  const scriptPath = path.join(SCRIPTS_DIR, name + ".lua");
  if (!fs.existsSync(scriptPath)) return res.status(404).send("-- not_found");

  const token = mintToken(name, hwid, ip);
  res.send(token);
});

app.get("/fetch/:token", (req, res) => {
  if (!checkCommon(req, res)) return;

  const hwid   = req.headers["x-hwid"];
  const ip     = req.ip;
  const result = burnToken(req.params.token, hwid, ip);

  res.setHeader("Content-Type","text/plain");
  res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");
  res.setHeader("Pragma","no-cache");
  res.setHeader("Expires","0");

  if (!result.ok) {
    const kick = encStr("pcall(function()game:GetService('TeleportService'):Teleport(0)end)");
    return res.status(403).send(`load(${kick})();error("${result.reason}",2)`);
  }

  const name = result.scriptName;
  const sp   = path.join(SCRIPTS_DIR, name + ".lua");
  if (!fs.existsSync(sp)) return res.status(404).send("-- not_found");

  const meta = readMeta();
  if (!meta[name]) meta[name] = { executions: 0 };
  meta[name].executions = (meta[name].executions||0) + 1;
  meta[name].lastExec   = Date.now();
  writeMeta(meta);

  const raw     = fs.readFileSync(sp, "utf8");
  const payload = meta[name].skipObfuscation
    ? buildRawPayload(raw, hwid)
    : buildPayload(raw, hwid, name);

  res.send(payload);
});

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN API
// ══════════════════════════════════════════════════════════════════════════════
function adminAuth(req, res, next) {
  const pw = req.body?.password || req.headers["x-admin-password"];
  if (pw !== UPLOAD_PASSWORD) return res.status(401).json({ error:"Wrong password" });
  next();
}

app.get("/api/scripts", (req, res) => {
  const meta  = readMeta();
  const files = fs.existsSync(SCRIPTS_DIR)
    ? fs.readdirSync(SCRIPTS_DIR).filter(f=>f.endsWith(".lua")) : [];
  res.json(files.map(f => {
    const name    = f.replace(".lua","");
    const stat    = fs.statSync(path.join(SCRIPTS_DIR,f));
    const content = fs.readFileSync(path.join(SCRIPTS_DIR,f),"utf8");
    const m       = meta[name]||{};
    return {
      name,
      size:            stat.size,
      lines:           content.split("\n").length,
      updated:         stat.mtime,
      executions:      m.executions||0,
      description:     m.description||"",
      skipObfuscation: m.skipObfuscation||false,
    };
  }));
});

app.post("/api/upload", adminAuth, (req, res) => {
  const { name, content, description, skipObfuscation } = req.body;
  if (!name||!content) return res.status(400).json({ error:"Name and content required." });
  const safe = name.replace(/[^a-zA-Z0-9_-]/g,"");
  if (!safe) return res.status(400).json({ error:"Invalid name." });
  const isNew = !fs.existsSync(path.join(SCRIPTS_DIR,safe+".lua"));
  fs.writeFileSync(path.join(SCRIPTS_DIR,safe+".lua"), content,"utf8");
  const meta = readMeta();
  if (!meta[safe]) meta[safe] = { created:Date.now(), executions:0 };
  if (description !== undefined) meta[safe].description = description;
  meta[safe].skipObfuscation = skipObfuscation === true;
  meta[safe].updated = Date.now();
  writeMeta(meta);
  res.json({ success:true, name:safe, isNew });
});

app.delete("/api/scripts/:name", adminAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g,"");
  const p    = path.join(SCRIPTS_DIR,name+".lua");
  if (!fs.existsSync(p)) return res.status(404).json({ error:"Not found." });
  fs.unlinkSync(p);
  const meta = readMeta(); delete meta[name]; writeMeta(meta);
  res.json({ success:true });
});

app.post("/api/scripts/:name/content", adminAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g,"");
  const p    = path.join(SCRIPTS_DIR,name+".lua");
  if (!fs.existsSync(p)) return res.status(404).json({ error:"Not found." });
  res.json({ content:fs.readFileSync(p,"utf8") });
});

app.post("/api/scripts/:name/reset-execs", adminAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g,"");
  const meta = readMeta();
  if (!meta[name]) return res.status(404).json({ error:"Not found." });
  meta[name].executions = 0; writeMeta(meta);
  res.json({ success:true });
});

app.post("/api/stats", adminAuth, (req, res) => {
  const meta  = readMeta();
  const files = fs.existsSync(SCRIPTS_DIR)
    ? fs.readdirSync(SCRIPTS_DIR).filter(f=>f.endsWith(".lua")) : [];
  const keys  = readKeys();
  const now   = Date.now();
  res.json({
    scriptCount:     files.length,
    totalExecutions: Object.values(meta).reduce((a,m)=>a+(m.executions||0),0),
    totalSize:       files.reduce((a,f)=>a+fs.statSync(path.join(SCRIPTS_DIR,f)).size,0),
    activeKeys:      Object.values(keys).filter(k=>k.active && now<k.expires).length,
    totalKeys:       Object.keys(keys).length,
  });
});

// ── KEY CRUD ─────────────────────────────────────────────────────────────────
app.post("/api/keys/generate", adminAuth, (req, res) => {
  const { duration_hours, note, maxUses } = req.body;
  if (!duration_hours||isNaN(duration_hours))
    return res.status(400).json({ error:"duration_hours required" });
  const keyStr  = "PA-" + crypto.randomBytes(10).toString("hex").toUpperCase();
  const now     = Date.now();
  const expires = now + duration_hours * 3_600_000;
  const keys    = readKeys();
  keys[keyStr]  = { active:true, created:now, expires, hwid:null, note:note||"", uses:0, maxUses:maxUses||null };
  writeKeys(keys);
  res.json({ key:keyStr, expires:new Date(expires).toISOString(), note:note||"" });
});

app.post("/api/keys/generate-batch", adminAuth, (req, res) => {
  const { duration_hours, note, maxUses, count } = req.body;
  if (!duration_hours || isNaN(duration_hours))
    return res.status(400).json({ error: "duration_hours required" });
  const num = parseInt(count) || 1;
  if (num < 1 || num > 50)
    return res.status(400).json({ error: "count must be between 1 and 50" });
  const now     = Date.now();
  const expires = now + duration_hours * 3_600_000;
  const keys    = readKeys();
  const generated = [];
  for (let i = 0; i < num; i++) {
    const keyStr = "PA-" + crypto.randomBytes(10).toString("hex").toUpperCase();
    keys[keyStr] = { active: true, created: now, expires, hwid: null, note: note || "", uses: 0, maxUses: maxUses || null };
    generated.push({ key: keyStr, expires: new Date(expires).toISOString() });
  }
  writeKeys(keys);
  res.json({ keys: generated, note: note || "" });
});

app.post("/api/keys/revoke", adminAuth, (req, res) => {
  const { key } = req.body;
  const keys    = readKeys();
  if (!keys[key]) return res.status(404).json({ error:"Key not found" });
  keys[key].active = false; writeKeys(keys);
  res.json({ success:true });
});

app.post("/api/keys/reset-hwid", adminAuth, (req, res) => {
  const { key } = req.body;
  const keys    = readKeys();
  if (!keys[key]) return res.status(404).json({ error:"Key not found" });
  keys[key].hwid = null; writeKeys(keys);
  res.json({ success:true });
});

app.delete("/api/keys/delete", adminAuth, (req, res) => {
  const { key } = req.body;
  const keys    = readKeys();
  if (!keys[key]) return res.status(404).json({ error:"Key not found" });
  delete keys[key]; writeKeys(keys);
  res.json({ success:true });
});

app.get("/api/keys/list", (req, res) => {
  const pw = req.headers["x-admin-password"];
  if (pw !== UPLOAD_PASSWORD) return res.status(401).json({ error:"Unauthorized" });
  const keys = readKeys();
  const now  = Date.now();
  res.json(Object.entries(keys).map(([k,v]) => ({
    key:k, active:v.active && now<v.expires, revoked:!v.active, expired:now>v.expires,
    hwid_bound:!!v.hwid, uses:v.uses||0, maxUses:v.maxUses||null,
    expires:new Date(v.expires).toISOString(), note:v.note||""
  })));
});

// ══════════════════════════════════════════════════════════════════════════════
//  EXECUTOR-FRIENDLY LOAD ENDPOINT (no UA/header requirements)
//  GET /load/:name?key=PA-...&hwid=HWID_VALUE
//  Designed for game:HttpGet() which cannot set custom headers
// ══════════════════════════════════════════════════════════════════════════════
app.get("/load/:name", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  const ip     = req.ip;
  const name   = (req.params.name || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const keyStr = req.query.key;
  const hwid   = req.query.hwid;

  // Rate limit by IP (reuse existing checkRate)
  if (!checkRate(ip)) return res.status(429).send("-- rate_limited");

  // Validate inputs
  if (!keyStr) return res.status(403).send(kickResponse("KEY_INVALID"));
  if (!hwid || hwid.length < 4) return res.status(403).send('load(string.char(112,99,97,108,108,40,102,117,110,99,116,105,111,110,40,41,103,97,109,101,58,71,101,116,83,101,114,118,105,99,101,40,39,84,101,108,101,112,111,114,116,83,101,114,118,105,99,101,39,41,58,84,101,108,101,112,111,114,116,40,48,41,101,110,100,41,41))()\nerror("[PubArmour] Missing HWID.",2)');

  // Validate key
  const kv = validateKey(keyStr, hwid);
  if (!kv.ok) {
    console.warn(`[LOAD] Key fail: ${kv.code} key=${keyStr} ip=${ip}`);
    return res.status(403).send(kickResponse(kv.code));
  }

  // Check script exists
  const scriptPath = path.join(SCRIPTS_DIR, name + ".lua");
  if (!fs.existsSync(scriptPath)) return res.status(404).send("-- not_found");

  // Track execution
  const meta = readMeta();
  if (!meta[name]) meta[name] = { executions: 0 };
  meta[name].executions = (meta[name].executions || 0) + 1;
  meta[name].lastExec   = Date.now();
  writeMeta(meta);

  // Build and return payload
  const raw     = fs.readFileSync(scriptPath, "utf8");
  const payload = meta[name].skipObfuscation
    ? buildRawPayload(raw, hwid)
    : buildPayload(raw, hwid, name);

  console.log(`[LOAD] OK name=${name} ip=${ip}`);
  res.send(payload);
});

// ══════════════════════════════════════════════════════════════════════════════
//  CATCH-ALL — serve index.html for unknown GET routes (SPA fallback)
// ══════════════════════════════════════════════════════════════════════════════
app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`\n🛡️  PubArmour running → http://localhost:${PORT}\n`);
});
