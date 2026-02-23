const {
  Client, GatewayIntentBits, SlashCommandBuilder,
  REST, Routes, EmbedBuilder, AttachmentBuilder
} = require("discord.js");
const fetch = (...args) => import("node-fetch").then(({default:f})=>f(...args));

const TOKEN           = process.env.DISCORD_TOKEN;
const CLIENT_ID       = process.env.DISCORD_CLIENT_ID;
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || "spaxisgay";
const API_URL         = process.env.API_URL || "http://localhost:3000";
const ALLOWED_ROLES   = (process.env.ALLOWED_ROLES || "").split(",").filter(Boolean);

// ── Startup env check ────────────────────────────────────────────────────────
if (!TOKEN)     { console.error("❌ DISCORD_TOKEN is not set!"); process.exit(1); }
if (!CLIENT_ID) { console.error("❌ DISCORD_CLIENT_ID is not set!"); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const C = { ok:0x00d4ff, err:0xff3366, info:0x0077ff, warn:0xffaa00 };

const commands = [
  // ── Script commands ────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("upload")
    .setDescription("Upload a Lua script to PubArmour")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true))
    .addAttachmentOption(o=>o.setName("file").setDescription(".lua file").setRequired(false))
    .addStringOption(o=>o.setName("content").setDescription("Inline content").setRequired(false))
    .addStringOption(o=>o.setName("description").setDescription("Description").setRequired(false)),

  new SlashCommandBuilder()
    .setName("deletescript")
    .setDescription("Delete a script")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("listscripts")
    .setDescription("List all hosted scripts"),

  new SlashCommandBuilder()
    .setName("scriptinfo")
    .setDescription("Get info + loader for a script")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("resetexecs")
    .setDescription("Reset execution count for a script")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("download")
    .setDescription("Download raw .lua source")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true)),

  // ── Key commands ───────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("genkey")
    .setDescription("Generate a new PubArmour key")
    .addIntegerOption(o=>o.setName("hours").setDescription("Duration in hours").setRequired(true))
    .addStringOption(o=>o.setName("note").setDescription("Note (e.g. username)").setRequired(false))
    .addIntegerOption(o=>o.setName("maxuses").setDescription("Max uses (leave blank = unlimited)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("revokekey")
    .setDescription("Revoke a key instantly")
    .addStringOption(o=>o.setName("key").setDescription("Key to revoke").setRequired(true)),

  new SlashCommandBuilder()
    .setName("deletekey")
    .setDescription("Permanently delete a key")
    .addStringOption(o=>o.setName("key").setDescription("Key to delete").setRequired(true)),

  new SlashCommandBuilder()
    .setName("resethwid")
    .setDescription("Reset HWID binding for a key")
    .addStringOption(o=>o.setName("key").setDescription("Key to reset").setRequired(true)),

  new SlashCommandBuilder()
    .setName("listkeys")
    .setDescription("List all keys"),

  new SlashCommandBuilder()
    .setName("checkkey")
    .setDescription("Check status of a specific key")
    .addStringOption(o=>o.setName("key").setDescription("Key to check").setRequired(true)),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View PubArmour statistics"),
].map(c=>c.toJSON());

// ── Command registration ─────────────────────────────────────────────────────
async function registerCommands() {
  try {
    console.log("⏳ Registering slash commands...");
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ PubArmour commands registered");
  } catch (err) {
    console.error("❌ Command registration failed:", err);
    throw err;
  }
}

// ── Permission check ─────────────────────────────────────────────────────────
function hasPerm(member) {
  if (!ALLOWED_ROLES.length) {
    console.warn("[WARN] ALLOWED_ROLES not set — denying all");
    return false;
  }
  return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
}

function ah() {
  return { "Content-Type": "application/json", "x-admin-password": UPLOAD_PASSWORD };
}

function denied() {
  return new EmbedBuilder().setColor(C.err).setTitle("🔒 Access Denied")
    .setDescription("You don't have the required role to use PubArmour.")
    .setFooter({ text: "PubArmour Security" });
}

function statusEmoji(k) {
  if (k.revoked) return "🚫 Revoked";
  if (k.expired) return "⌛ Expired";
  if (k.active)  return "✅ Active";
  return "❓ Unknown";
}

// ── Interaction handler ──────────────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();
  if (!hasPerm(interaction.member)) return interaction.editReply({ embeds: [denied()] });

  const cmd = interaction.commandName;

  try {

    // ── /upload ──────────────────────────────────────────────────────────────
    if (cmd === "upload") {
      const name   = interaction.options.getString("name");
      const desc   = interaction.options.getString("description") || "";
      const att    = interaction.options.getAttachment("file");
      const inline = interaction.options.getString("content");
      let content  = inline || "";
      if (att) {
        try { content = await (await fetch(att.url)).text(); }
        catch { return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Failed to fetch attachment.")] }); }
      }
      if (!content) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Provide a file or inline content.")] });
      const res  = await fetch(`${API_URL}/api/upload`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, name, content, description: desc }) });
      const data = await res.json();
      if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
      const loader = `Pub_key = "PA-XXXXXXXXXXXXXXXXXXXX"\nloadstring(game:HttpGet("${API_URL}/auth/${data.name}?key="..Pub_key))()`;
      return interaction.editReply({ embeds: [
        new EmbedBuilder().setColor(C.ok).setTitle("✅ Script Uploaded & Protected")
          .addFields(
            { name: "Name",       value: `\`${data.name}\``,                        inline: true },
            { name: "Status",     value: data.isNew ? "🆕 New" : "🔄 Updated",      inline: true },
            { name: "Loader",     value: `\`\`\`lua\n${loader}\n\`\`\`` },
            { name: "Protection", value: "🛡️ Key+HWID+Token+XOR+Anti-dump+Kick" }
          ).setFooter({ text: "PubArmour v2.0" })
      ]});
    }

    // ── /deletescript ────────────────────────────────────────────────────────
    if (cmd === "deletescript") {
      const name = interaction.options.getString("name");
      const res  = await fetch(`${API_URL}/api/scripts/${name}`, { method: "DELETE", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
      const data = await res.json();
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
        .setDescription(data.success ? `🗑️ \`${name}\` deleted.` : "❌ " + data.error)] });
    }

    // ── /listscripts ─────────────────────────────────────────────────────────
    if (cmd === "listscripts") {
      const res  = await fetch(`${API_URL}/api/scripts`);
      const list = await res.json();
      if (!list.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setDescription("📭 No scripts.")] });
      const rows = list.map((s, i) =>
        `\`${String(i+1).padStart(2,"0")}\` **${s.name}** — ${s.lines} lines · ${(s.size/1024).toFixed(1)}KB · ▶ ${s.executions} runs${s.description ? `\n> ${s.description}` : ""}`
      ).join("\n\n");
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle(`🛡️ PubArmour — ${list.length} scripts`).setDescription(rows.slice(0, 4000))] });
    }

    // ── /scriptinfo ──────────────────────────────────────────────────────────
    if (cmd === "scriptinfo") {
      const name = interaction.options.getString("name");
      const list = await (await fetch(`${API_URL}/api/scripts`)).json();
      const s    = list.find(x => x.name === name);
      if (!s) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ \`${name}\` not found.`)] });
      const loader = `Pub_key = "PA-XXXXXXXXXXXXXXXXXXXX"\nloadstring(game:HttpGet("${API_URL}/auth/${name}?key="..Pub_key))()`;
      return interaction.editReply({ embeds: [
        new EmbedBuilder().setColor(C.info).setTitle(`📜 ${name}`).setDescription(s.description || "*No description*")
          .addFields(
            { name: "Lines", value: String(s.lines),               inline: true },
            { name: "Size",  value: (s.size/1024).toFixed(1)+"KB", inline: true },
            { name: "Runs",  value: String(s.executions),          inline: true },
            { name: "Loader", value: `\`\`\`lua\n${loader}\n\`\`\`` }
          )
      ]});
    }

    // ── /resetexecs ──────────────────────────────────────────────────────────
    if (cmd === "resetexecs") {
      const name = interaction.options.getString("name");
      const res  = await fetch(`${API_URL}/api/scripts/${name}/reset-execs`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
      const data = await res.json();
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
        .setDescription(data.success ? `✅ Counter reset for \`${name}\`.` : "❌ " + data.error)] });
    }

    // ── /download ────────────────────────────────────────────────────────────
    if (cmd === "download") {
      const name = interaction.options.getString("name");
      const res  = await fetch(`${API_URL}/api/scripts/${name}/content`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
      const data = await res.json();
      if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
      const file = new AttachmentBuilder(Buffer.from(data.content, "utf8"), { name: `${name}.lua` });
      return interaction.editReply({ files: [file], embeds: [new EmbedBuilder().setColor(C.ok).setDescription(`⬇️ \`${name}.lua\``)] });
    }

    // ── /genkey ──────────────────────────────────────────────────────────────
    if (cmd === "genkey") {
      const hours   = interaction.options.getInteger("hours");
      const note    = interaction.options.getString("note") || "";
      const maxUses = interaction.options.getInteger("maxuses") || null;
      const res  = await fetch(`${API_URL}/api/keys/generate`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, duration_hours: hours, note, maxUses }) });
      const data = await res.json();
      if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
      return interaction.editReply({ embeds: [
        new EmbedBuilder().setColor(C.ok).setTitle("🔑 Key Generated")
          .addFields(
            { name: "Key",      value: `\`${data.key}\`` },
            { name: "Duration", value: `${hours} hours`,                       inline: true },
            { name: "Max Uses", value: maxUses ? String(maxUses) : "Unlimited", inline: true },
            { name: "Expires",  value: data.expires },
            { name: "Note",     value: note || "—" }
          ).setFooter({ text: "PubArmour Key System" })
      ]});
    }

    // ── /revokekey ───────────────────────────────────────────────────────────
    if (cmd === "revokekey") {
      const key  = interaction.options.getString("key");
      const res  = await fetch(`${API_URL}/api/keys/revoke`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, key }) });
      const data = await res.json();
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
        .setDescription(data.success ? `🚫 Key \`${key}\` revoked. User will be kicked on next execution.` : "❌ " + data.error)] });
    }

    // ── /deletekey ───────────────────────────────────────────────────────────
    if (cmd === "deletekey") {
      const key  = interaction.options.getString("key");
      const res  = await fetch(`${API_URL}/api/keys/delete`, { method: "DELETE", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, key }) });
      const data = await res.json();
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
        .setDescription(data.success ? `🗑️ Key \`${key}\` permanently deleted.` : "❌ " + data.error)] });
    }

    // ── /resethwid ───────────────────────────────────────────────────────────
    if (cmd === "resethwid") {
      const key  = interaction.options.getString("key");
      const res  = await fetch(`${API_URL}/api/keys/reset-hwid`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, key }) });
      const data = await res.json();
      return interaction.editReply({ embeds: [
        new EmbedBuilder().setColor(data.success ? C.ok : C.err).setTitle(data.success ? "✅ HWID Reset" : "❌ Error")
          .setDescription(data.success ? `HWID cleared for \`${key}\`.\nNext execution will bind to the new device.` : data.error)
      ]});
    }

    // ── /listkeys ────────────────────────────────────────────────────────────
    if (cmd === "listkeys") {
      const res  = await fetch(`${API_URL}/api/keys/list`, { headers: { "x-admin-password": UPLOAD_PASSWORD } });
      const list = await res.json();
      if (!list.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setDescription("No keys found.")] });
      const rows = list.slice(0, 20).map((k, i) =>
        `\`${String(i+1).padStart(2,"0")}\` \`${k.key}\` ${statusEmoji(k)} | HWID: ${k.hwid_bound ? "🔒" : "🔓"} | Uses: ${k.uses}${k.maxUses ? "/"+k.maxUses : ""} | Exp: ${k.expires.slice(0,10)}${k.note ? " | "+k.note : ""}`
      ).join("\n");
      return interaction.editReply({ embeds: [
        new EmbedBuilder().setColor(C.info).setTitle(`🔑 Keys (${list.length})`).setDescription(rows.slice(0, 4000))
      ]});
    }

    // ── /checkkey ────────────────────────────────────────────────────────────
    if (cmd === "checkkey") {
      const key  = interaction.options.getString("key");
      const list = await (await fetch(`${API_URL}/api/keys/list`, { headers: { "x-admin-password": UPLOAD_PASSWORD } })).json();
      const k    = list.find(x => x.key === key);
      if (!k) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Key not found.")] });
      return interaction.editReply({ embeds: [
        new EmbedBuilder().setColor(k.active ? C.ok : C.err).setTitle("🔑 Key Info")
          .addFields(
            { name: "Key",     value: `\`${k.key}\`` },
            { name: "Status",  value: statusEmoji(k),                                   inline: true },
            { name: "HWID",    value: k.hwid_bound ? "🔒 Bound" : "🔓 Unbound",         inline: true },
            { name: "Uses",    value: `${k.uses}${k.maxUses ? "/"+k.maxUses : " (unlimited)"}`, inline: true },
            { name: "Expires", value: k.expires },
            { name: "Note",    value: k.note || "—" }
          )
      ]});
    }

    // ── /stats ───────────────────────────────────────────────────────────────
    if (cmd === "stats") {
      const res  = await fetch(`${API_URL}/api/stats`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
      const data = await res.json();
      if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
      const size = data.totalSize < 1024 ? data.totalSize+"B" : (data.totalSize/1024).toFixed(1)+"KB";
      return interaction.editReply({ embeds: [
        new EmbedBuilder().setColor(C.ok).setTitle("📊 PubArmour Statistics")
          .addFields(
            { name: "Scripts",    value: String(data.scriptCount),              inline: true },
            { name: "Executions", value: data.totalExecutions.toLocaleString(), inline: true },
            { name: "Storage",    value: size,                                  inline: true },
            { name: "Active Keys",value: String(data.activeKeys),               inline: true },
            { name: "Total Keys", value: String(data.totalKeys),                inline: true },
          )
          .addFields({ name: "Security Layers", value: "✅ Key Validation\n✅ HWID Binding\n✅ One-time Tokens (30s)\n✅ UA Whitelist + Browser Blocklist\n✅ Rate Limiting\n✅ Honeypot Traps\n✅ XOR Obfuscation (chunked)\n✅ Anti-timing Check\n✅ Runtime HWID Re-check\n✅ Instant Kick on Violation" })
          .setFooter({ text: "PubArmour v2.0" })
      ]});
    }

  } catch (err) {
    console.error(`❌ Error in /${cmd}:`, err);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ Internal error: \`${err.message}\``)] });
  }
});

// ── Bot startup ──────────────────────────────────────────────────────────────
client.once("ready", () => console.log(`🛡️ PubArmour bot ready: ${client.user.tag}`));

client.on("error", err => console.error("❌ Discord client error:", err));
process.on("unhandledRejection", err => console.error("❌ Unhandled rejection:", err));

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  });
