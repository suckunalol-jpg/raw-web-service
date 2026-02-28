const {
  Client, GatewayIntentBits, SlashCommandBuilder,
  REST, Routes, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const fetch = (...args) => import("node-fetch").then(({default:f})=>f(...args));
const fs   = require("fs");
const path = require("path");

const TOKEN           = process.env.DISCORD_TOKEN;
const CLIENT_ID       = process.env.DISCORD_CLIENT_ID;
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || "spaxisgay";
const API_URL         = process.env.API_URL || "http://localhost:3000";
const ALLOWED_ROLES   = (process.env.ALLOWED_ROLES || "").split(",").filter(Boolean);
const ADMIN_ROLES     = (process.env.ADMIN_ROLES || "").split(",").filter(Boolean);
const HWID_RESET_ENABLED = (process.env.HWID_RESET_ENABLED || "true") === "true";

if (!TOKEN)     { console.error("❌ DISCORD_TOKEN is not set!"); process.exit(1); }
if (!CLIENT_ID) { console.error("❌ DISCORD_CLIENT_ID is not set!"); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const C = { ok:0x00d4ff, err:0xff3366, info:0x0077ff, warn:0xffaa00 };

// ══════════════════════════════════════════════════════════════════════════════
//  REDEMPTION STORAGE
//  Tracks which key each user has redeemed per script: userId|scriptName -> key
// ══════════════════════════════════════════════════════════════════════════════
const REDEEMED_PATH = path.join(__dirname, "redeemed.json");

function readRedeemed() {
  try { return JSON.parse(fs.readFileSync(REDEEMED_PATH, "utf8")); } catch { return {}; }
}
function writeRedeemed(data) {
  fs.writeFileSync(REDEEMED_PATH, JSON.stringify(data, null, 2));
}
function getRedeemedKey(userId, scriptName) {
  return readRedeemed()[`${userId}|${scriptName}`] || null;
}
function setRedeemedKey(userId, scriptName, key) {
  const data = readRedeemed();
  data[`${userId}|${scriptName}`] = key;
  writeRedeemed(data);
}

// ══════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ══════════════════════════════════════════════════════════════════════════════
const commands = [
  // Panel (whitelisted)
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post a script panel in this channel")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true)),

  // Script management (admin)
  new SlashCommandBuilder()
    .setName("upload")
    .setDescription("Upload a Lua script to PubArmour")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true))
    .addAttachmentOption(o=>o.setName("file").setDescription(".lua file").setRequired(false))
    .addStringOption(o=>o.setName("content").setDescription("Inline Lua content").setRequired(false))
    .addStringOption(o=>o.setName("description").setDescription("Description").setRequired(false))
    .addBooleanOption(o=>o.setName("skip_obfuscation").setDescription("Skip re-obfuscation").setRequired(false)),

  new SlashCommandBuilder()
    .setName("deletescript")
    .setDescription("Delete a script")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("listscripts")
    .setDescription("List all hosted scripts"),

  new SlashCommandBuilder()
    .setName("download")
    .setDescription("Download the raw .lua source of a script")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("resetexecs")
    .setDescription("Reset execution counter for a script")
    .addStringOption(o=>o.setName("script").setDescription("Script name").setRequired(true)),

  // Key management (admin)
  new SlashCommandBuilder()
    .setName("genkey")
    .setDescription("Generate key(s)")
    .addIntegerOption(o=>o.setName("hours").setDescription("Duration in hours").setRequired(true))
    .addIntegerOption(o=>o.setName("count").setDescription("Number of keys to generate (max 50)").setRequired(false))
    .addStringOption(o=>o.setName("note").setDescription("Note e.g. username or Discord ID").setRequired(false))
    .addIntegerOption(o=>o.setName("maxuses").setDescription("Max uses per key (blank = unlimited)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("revokekey")
    .setDescription("Revoke a key (disables it without deleting)")
    .addStringOption(o=>o.setName("key").setDescription("Key to revoke (PA-...)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("deletekey")
    .setDescription("Permanently delete a key")
    .addStringOption(o=>o.setName("key").setDescription("Key to delete (PA-...)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("checkkey")
    .setDescription("Check the status of a key")
    .addStringOption(o=>o.setName("key").setDescription("Key to check (PA-...)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("listkeys")
    .setDescription("List all keys"),
].map(c=>c.toJSON());

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════
async function registerCommands() {
  console.log("⏳ Registering slash commands...");
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ PubArmour commands registered");
}

function isAdmin(member) {
  if (ADMIN_ROLES.length) return member.roles.cache.some(r => ADMIN_ROLES.includes(r.id));
  if (ALLOWED_ROLES.length) return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
  return false;
}

function hasPerm(member) {
  if (isAdmin(member)) return true;
  if (ALLOWED_ROLES.length) return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
  return false;
}

function ah() {
  return { "Content-Type": "application/json", "x-admin-password": UPLOAD_PASSWORD };
}

function denied() {
  return new EmbedBuilder().setColor(C.err).setTitle("🔒 Access Denied")
    .setDescription("You don't have the required role.")
    .setFooter({ text: "PubArmour © By DQ" });
}

function adminOnly() {
  return new EmbedBuilder().setColor(C.err).setTitle("🔒 Admin Only")
    .setDescription("This command requires admin permissions.")
    .setFooter({ text: "PubArmour © By DQ" });
}

function statusEmoji(k) {
  if (k.revoked) return "🚫 Revoked";
  if (k.expired) return "⌛ Expired";
  if (k.active)  return "✅ Active";
  return "❓ Unknown";
}

function buildLoader(scriptName, key) {
  const url = `${API_URL}/load/${scriptName}`;
  return [
    `Pub_key = "${key}"`,
    `local hwid = tostring(game:GetService("RbxAnalyticsService"):GetClientId())`,
    `local url = "${url}?key="..Pub_key.."&hwid="..hwid`,
    `local ok, res = pcall(function()`,
    `    return request({Url=url, Method="GET", Headers={["User-Agent"]="PubArmour/2.0"}})`,
    `end)`,
    `if ok and res and res.Body then`,
    `    loadstring(res.Body)()`,
    `else`,
    `    loadstring(game:HttpGet(url))()`,
    `end`,
  ].join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
//  PANEL BUILDER
// ══════════════════════════════════════════════════════════════════════════════
function buildPanelEmbed(scriptName, s) {
  return new EmbedBuilder()
    .setColor(C.ok)
    .setTitle(`🛡️ PubArmour — ${scriptName}`)
    .setDescription(s?.description || "*No description*")
    .addFields(
      { name: "Lines",      value: String(s?.lines || "?"),              inline: true },
      { name: "Size",       value: ((s?.size||0)/1024).toFixed(1)+"KB",  inline: true },
      { name: "Executions", value: String(s?.executions || 0),           inline: true },
      { name: "Protection", value: s?.skipObfuscation ? "⚠️ Raw (HWID only)" : "🛡️ Full (Key+HWID+XOR+Anti-dump)" },
      { name: "Access",     value: "Press **🔑 Redeem Key** below to enter your key and unlock your loader." },
    )
    .setFooter({ text: "PubArmour © By DQ" })
    .setTimestamp();
}

// Panel buttons — visible to everyone in the channel
function buildPanelRows(scriptName) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pa_redeem_${scriptName}`).setLabel("🔑 Redeem Key").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pa_refresh_${scriptName}`).setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
  )];
}

// Buyer buttons — shown ephemerally after a successful key redemption
function buildBuyerRow(scriptName) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pa_buyerloader_${scriptName}`).setLabel("📋 Get Loader").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pa_buyerstats_${scriptName}`).setLabel("📊 Stats").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pa_buyerresethwid_${scriptName}`).setLabel("🔄 Reset HWID").setStyle(ButtonStyle.Secondary),
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ══════════════════════════════════════════════════════════════════════════════
client.on("interactionCreate", async interaction => {

  // ── SLASH COMMANDS ─────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;

    // /panel posts publicly so everyone can click the buttons.
    // All other commands reply ephemerally to keep key/admin data private.
    if (cmd === "panel") {
      if (!hasPerm(interaction.member)) {
        return interaction.reply({ embeds: [denied()], ephemeral: true });
      }
      try {
        await interaction.deferReply();
        const name = interaction.options.getString("name");
        const list = await (await fetch(`${API_URL}/api/scripts`)).json();
        const s    = list.find(x => x.name === name);
        if (!s) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
            .setDescription(`❌ Script \`${name}\` not found. Upload it first.`)
            .setFooter({ text: "PubArmour © By DQ" })] });
        }
        return interaction.editReply({ embeds: [buildPanelEmbed(name, s)], components: buildPanelRows(name) });
      } catch (err) {
        console.error("❌ /panel error:", err);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
          .setDescription(`❌ Error: \`${err.message}\``)
          .setFooter({ text: "PubArmour © By DQ" })] });
      }
    }

    // All other slash commands — ephemeral replies
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      console.error(`Failed to defer /${cmd}:`, err);
      return;
    }

    if (!hasPerm(interaction.member)) return interaction.editReply({ embeds: [denied()] });

    try {
      // ── /upload ───────────────────────────────────────────────────────────
      if (cmd === "upload") {
        if (!isAdmin(interaction.member)) return interaction.editReply({ embeds: [adminOnly()] });
        const name    = interaction.options.getString("name");
        const desc    = interaction.options.getString("description") || "";
        const att     = interaction.options.getAttachment("file");
        const inline  = interaction.options.getString("content");
        const skipObf = interaction.options.getBoolean("skip_obfuscation") || false;
        let content   = inline || "";
        if (att) {
          try { content = await (await fetch(att.url)).text(); }
          catch { return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Failed to fetch attachment.")] }); }
        }
        if (!content) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Provide a file or inline content.")] });
        const res  = await fetch(`${API_URL}/api/upload`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, name, content, description: desc, skipObfuscation: skipObf }) });
        const data = await res.json();
        if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
        const loader = buildLoader(data.name, "PA-XXXXXXXXXXXXXXXXXXXX");
        return interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(C.ok).setTitle("✅ Script Uploaded & Protected")
            .addFields(
              { name: "Name",        value: `\`${data.name}\``,                       inline: true },
              { name: "Status",      value: data.isNew ? "🆕 New" : "🔄 Updated",     inline: true },
              { name: "Obfuscation", value: skipObf ? "⚠️ Skipped" : "🛡️ Enabled",   inline: true },
              { name: "Loader",      value: `\`\`\`lua\n${loader}\n\`\`\`` },
            ).setFooter({ text: `Use /panel ${data.name} to post a panel | PubArmour © By DQ` })
        ]});
      }

      // ── /deletescript ─────────────────────────────────────────────────────
      if (cmd === "deletescript") {
        if (!isAdmin(interaction.member)) return interaction.editReply({ embeds: [adminOnly()] });
        const name = interaction.options.getString("name");
        const res  = await fetch(`${API_URL}/api/scripts/${name}`, { method: "DELETE", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `🗑️ \`${name}\` deleted.` : "❌ " + data.error)
          .setFooter({ text: "PubArmour © By DQ" })] });
      }

      // ── /listscripts ──────────────────────────────────────────────────────
      if (cmd === "listscripts") {
        const res  = await fetch(`${API_URL}/api/scripts`);
        const list = await res.json();
        if (!list.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setDescription("📭 No scripts.").setFooter({ text: "PubArmour © By DQ" })] });
        const rows = list.map((s, i) =>
          `\`${String(i+1).padStart(2,"0")}\` **${s.name}** — ${s.lines} lines · ${(s.size/1024).toFixed(1)}KB · ▶ ${s.executions} runs${s.skipObfuscation ? " ⚠️" : " 🛡️"}${s.description ? `\n> ${s.description}` : ""}`
        ).join("\n\n");
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info)
          .setTitle(`🛡️ PubArmour — ${list.length} script(s)`)
          .setDescription(rows.slice(0, 4000))
          .setFooter({ text: "PubArmour © By DQ" })] });
      }

      // ── /download ─────────────────────────────────────────────────────────
      if (cmd === "download") {
        if (!isAdmin(interaction.member)) return interaction.editReply({ embeds: [adminOnly()] });
        const name = interaction.options.getString("name");
        const res  = await fetch(`${API_URL}/api/scripts/${name}/content`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
        const data = await res.json();
        if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
        const file = new AttachmentBuilder(Buffer.from(data.content, "utf8"), { name: `${name}.lua` });
        return interaction.editReply({ files: [file], embeds: [new EmbedBuilder().setColor(C.ok).setDescription(`⬇️ \`${name}.lua\``).setFooter({ text: "PubArmour © By DQ" })] });
      }

      // ── /resetexecs ───────────────────────────────────────────────────────
      if (cmd === "resetexecs") {
        if (!isAdmin(interaction.member)) return interaction.editReply({ embeds: [adminOnly()] });
        const name = interaction.options.getString("script");
        const res  = await fetch(`${API_URL}/api/scripts/${name}/reset-execs`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `✅ Exec counter reset for \`${name}\`.` : "❌ " + data.error)
          .setFooter({ text: "PubArmour © By DQ" })] });
      }

      // ── /genkey ───────────────────────────────────────────────────────────
      if (cmd === "genkey") {
        if (!isAdmin(interaction.member)) return interaction.editReply({ embeds: [adminOnly()] });
        const hours   = interaction.options.getInteger("hours");
        const count   = interaction.options.getInteger("count") || 1;
        const note    = interaction.options.getString("note") || "";
        const maxUses = interaction.options.getInteger("maxuses") || null;
        if (hours < 1) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Hours must be >= 1.")] });
        if (count < 1 || count > 50) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Count must be 1–50.")] });
        const res  = await fetch(`${API_URL}/api/keys/generate-batch`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, duration_hours: hours, note, maxUses, count }) });
        const data = await res.json();
        if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
        const keyList = data.keys.map(k => `\`${k.key}\``).join("\n");
        return interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(C.ok).setTitle(`🔑 ${data.keys.length} Key(s) Generated`)
            .addFields(
              { name: "Keys",     value: keyList.slice(0, 1024) },
              { name: "Duration", value: `${hours}h`,                                    inline: true },
              { name: "Max Uses", value: maxUses ? String(maxUses) : "Unlimited",         inline: true },
              { name: "Expires",  value: data.keys[0].expires },
              { name: "Note",     value: note || "—" },
            ).setFooter({ text: "PubArmour © By DQ" })
        ]});
      }

      // ── /revokekey ────────────────────────────────────────────────────────
      if (cmd === "revokekey") {
        if (!isAdmin(interaction.member)) return interaction.editReply({ embeds: [adminOnly()] });
        const key  = interaction.options.getString("key").trim();
        const res  = await fetch(`${API_URL}/api/keys/revoke`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, key }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `🚫 \`${key}\` revoked.` : "❌ " + data.error)
          .setFooter({ text: "PubArmour © By DQ" })] });
      }

      // ── /deletekey ────────────────────────────────────────────────────────
      if (cmd === "deletekey") {
        if (!isAdmin(interaction.member)) return interaction.editReply({ embeds: [adminOnly()] });
        const key  = interaction.options.getString("key").trim();
        const res  = await fetch(`${API_URL}/api/keys/delete`, { method: "DELETE", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, key }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `🗑️ \`${key}\` deleted permanently.` : "❌ " + data.error)
          .setFooter({ text: "PubArmour © By DQ" })] });
      }

      // ── /checkkey ─────────────────────────────────────────────────────────
      if (cmd === "checkkey") {
        if (!isAdmin(interaction.member)) return interaction.editReply({ embeds: [adminOnly()] });
        const key  = interaction.options.getString("key").trim();
        const list = await (await fetch(`${API_URL}/api/keys/list`, { headers: { "x-admin-password": UPLOAD_PASSWORD } })).json();
        const k    = list.find(x => x.key === key);
        if (!k) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Key not found.").setFooter({ text: "PubArmour © By DQ" })] });
        return interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(k.active ? C.ok : C.err).setTitle("🔑 Key Info")
            .addFields(
              { name: "Key",     value: `\`${k.key}\`` },
              { name: "Status",  value: statusEmoji(k),                                    inline: true },
              { name: "HWID",    value: k.hwid_bound ? "🔒 Bound" : "🔓 Unbound",          inline: true },
              { name: "Uses",    value: `${k.uses}${k.maxUses ? "/"+k.maxUses : " (∞)"}`,  inline: true },
              { name: "Expires", value: k.expires },
              { name: "Note",    value: k.note || "—" },
            ).setFooter({ text: "PubArmour © By DQ" })
        ]});
      }

      // ── /listkeys ─────────────────────────────────────────────────────────
      if (cmd === "listkeys") {
        if (!isAdmin(interaction.member)) return interaction.editReply({ embeds: [adminOnly()] });
        const res  = await fetch(`${API_URL}/api/keys/list`, { headers: { "x-admin-password": UPLOAD_PASSWORD } });
        const list = await res.json();
        if (!list.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setDescription("No keys found.").setFooter({ text: "PubArmour © By DQ" })] });
        const rows = list.slice(0, 25).map((k, i) =>
          `\`${String(i+1).padStart(2,"0")}\` \`${k.key}\` ${statusEmoji(k)} | HWID: ${k.hwid_bound ? "Bound" : "Unbound"} | Uses: ${k.uses}${k.maxUses ? "/"+k.maxUses : ""} | Exp: ${k.expires.slice(0,10)}${k.note ? " | "+k.note : ""}`
        ).join("\n");
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info)
          .setTitle(`🔑 Keys (${list.length})`)
          .setDescription(rows.slice(0, 4000))
          .setFooter({ text: "PubArmour © By DQ" })] });
      }

    } catch (err) {
      console.error(`❌ Error in /${cmd}:`, err);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
        .setDescription(`❌ Error: \`${err.message}\``)
        .setFooter({ text: "PubArmour © By DQ" })] });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  BUTTON HANDLER
  // ══════════════════════════════════════════════════════════════════════════
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (!id.startsWith("pa_")) return;

    const withoutPrefix   = id.slice(3);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const action     = withoutPrefix.slice(0, firstUnderscore);
    const scriptName = withoutPrefix.slice(firstUnderscore + 1);

    try {
      // ── Redeem Key — open to everyone ─────────────────────────────────────
      if (action === "redeem") {
        const modal = new ModalBuilder()
          .setCustomId(`pm_redeem_${scriptName}`)
          .setTitle(`Redeem Key — ${scriptName}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("key")
              .setLabel("Enter your key")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("PA-...")
              .setRequired(true)
          )
        );
        return interaction.showModal(modal);
      }

      // ── Refresh — open to everyone ─────────────────────────────────────────
      if (action === "refresh") {
        await interaction.deferUpdate();
        const list = await (await fetch(`${API_URL}/api/scripts`)).json();
        const s    = list.find(x => x.name === scriptName);
        if (!s) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`\`${scriptName}\` no longer exists.`)], components: [] });
        return interaction.editReply({ embeds: [buildPanelEmbed(scriptName, s)], components: buildPanelRows(scriptName) });
      }

      // ── Buyer: Get Loader ──────────────────────────────────────────────────
      if (action === "buyerloader") {
        await interaction.deferReply({ ephemeral: true });
        const key = getRedeemedKey(interaction.user.id, scriptName);
        if (!key) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
            .setDescription("❌ You haven't redeemed a key for this script yet.\nClick **🔑 Redeem Key** on the panel first.")
            .setFooter({ text: "PubArmour © By DQ" })] });
        }
        const loader = buildLoader(scriptName, key);
        return interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(C.info)
            .setTitle(`📋 Loader — ${scriptName}`)
            .setDescription(`\`\`\`lua\n${loader}\n\`\`\``)
            .setFooter({ text: "PubArmour © By DQ" }),
        ]});
      }

      // ── Buyer: Stats ───────────────────────────────────────────────────────
      if (action === "buyerstats") {
        await interaction.deferReply({ ephemeral: true });
        const key = getRedeemedKey(interaction.user.id, scriptName);
        if (!key) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
            .setDescription("❌ Redeem a key first to view stats.")
            .setFooter({ text: "PubArmour © By DQ" })] });
        }
        const res  = await fetch(`${API_URL}/api/stats`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
        const data = await res.json();
        if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error).setFooter({ text: "PubArmour © By DQ" })] });
        const size = data.totalSize < 1024 ? data.totalSize+"B" : (data.totalSize/1024).toFixed(1)+"KB";
        return interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(C.ok).setTitle("📊 PubArmour Statistics")
            .addFields(
              { name: "Scripts",     value: String(data.scriptCount),               inline: true },
              { name: "Executions",  value: data.totalExecutions.toLocaleString(),  inline: true },
              { name: "Storage",     value: size,                                   inline: true },
              { name: "Active Keys", value: String(data.activeKeys),                inline: true },
              { name: "Total Keys",  value: String(data.totalKeys),                 inline: true },
            ).setFooter({ text: "PubArmour © By DQ" }),
        ]});
      }

      // ── Buyer: Reset HWID ──────────────────────────────────────────────────
      if (action === "buyerresethwid") {
        await interaction.deferReply({ ephemeral: true });
        const key = getRedeemedKey(interaction.user.id, scriptName);
        if (!key) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
            .setDescription("❌ Redeem a key first to reset your HWID.")
            .setFooter({ text: "PubArmour © By DQ" })] });
        }
        if (!HWID_RESET_ENABLED) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.warn)
            .setTitle("🔒 HWID Reset Disabled")
            .setDescription("An admin has disabled HWID resets. Contact an admin for help.")
            .setFooter({ text: "PubArmour © By DQ" })] });
        }
        const res  = await fetch(`${API_URL}/api/keys/reset-hwid`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, key }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `✅ HWID cleared for your key.` : "❌ " + data.error)
          .setFooter({ text: "PubArmour © By DQ" })] });
      }

    } catch (err) {
      console.error(`Button [${action}] error:`, err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ ${err.message}`).setFooter({ text: "PubArmour © By DQ" })], ephemeral: true });
        }
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ ${err.message}`).setFooter({ text: "PubArmour © By DQ" })] });
      } catch (e2) {
        console.error("Failed to send button error response:", e2);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MODAL SUBMIT HANDLER
  // ══════════════════════════════════════════════════════════════════════════
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;
    if (!id.startsWith("pm_")) return;

    const withoutPrefix   = id.slice(3);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const action     = withoutPrefix.slice(0, firstUnderscore);
    const scriptName = withoutPrefix.slice(firstUnderscore + 1);

    await interaction.deferReply({ ephemeral: true });

    try {
      // ── Redeem Key modal submit ────────────────────────────────────────────
      if (action === "redeem") {
        const key = interaction.fields.getTextInputValue("key").trim();

        if (!key.startsWith("PA-")) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
            .setDescription("❌ Invalid key format. Keys must start with `PA-`.")
            .setFooter({ text: "PubArmour © By DQ" })] });
        }

        // Validate key via admin API
        const list = await (await fetch(`${API_URL}/api/keys/list`, { headers: { "x-admin-password": UPLOAD_PASSWORD } })).json();
        const k = list.find(x => x.key === key);

        if (!k) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
            .setDescription("❌ Key not found. Please double-check your key and try again.")
            .setFooter({ text: "PubArmour © By DQ" })] });
        }
        if (!k.active || k.revoked) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
            .setDescription("❌ This key has been revoked. Contact an admin.")
            .setFooter({ text: "PubArmour © By DQ" })] });
        }
        if (k.expired) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
            .setDescription("❌ This key has expired. Contact an admin for a new key.")
            .setFooter({ text: "PubArmour © By DQ" })] });
        }
        if (k.maxUses && k.uses >= k.maxUses) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
            .setDescription("❌ This key has reached its maximum number of uses.")
            .setFooter({ text: "PubArmour © By DQ" })] });
        }

        // Store the redemption so buyer buttons auto-fill the key
        setRedeemedKey(interaction.user.id, scriptName, key);

        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.ok)
            .setTitle("✅ Key Redeemed!")
            .setDescription(`Your key has been verified for **${scriptName}**.\nUse the buttons below to get your loader or manage your access.`)
            .addFields({ name: "Your Key", value: `\`${key}\`` })
            .setFooter({ text: "PubArmour © By DQ" }),
          ],
          components: [buildBuyerRow(scriptName)],
        });
      }

    } catch (err) {
      console.error(`❌ Modal [${action}]:`, err);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err)
        .setDescription(`❌ ${err.message}`)
        .setFooter({ text: "PubArmour © By DQ" })] });
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  STARTUP
// ══════════════════════════════════════════════════════════════════════════════
client.once("clientReady", () => console.log(`PubArmour bot ready: ${client.user.tag}`));
client.on("error", err => console.error("❌ Discord client error:", err));
process.on("unhandledRejection", err => console.error("❌ Unhandled rejection:", err));

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => { console.error("❌ Startup failed:", err); process.exit(1); });
