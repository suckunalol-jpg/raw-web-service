const {
  Client, GatewayIntentBits, SlashCommandBuilder,
  REST, Routes, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const fetch = (...args) => import("node-fetch").then(({default:f})=>f(...args));

const TOKEN           = process.env.DISCORD_TOKEN;
const CLIENT_ID       = process.env.DISCORD_CLIENT_ID;
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || "spaxisgay";
const API_URL         = process.env.API_URL || "http://localhost:3000";
const ALLOWED_ROLES   = (process.env.ALLOWED_ROLES || "").split(",").filter(Boolean);

if (!TOKEN)     { console.error("❌ DISCORD_TOKEN is not set!"); process.exit(1); }
if (!CLIENT_ID) { console.error("❌ DISCORD_CLIENT_ID is not set!"); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const C = { ok:0x00d4ff, err:0xff3366, info:0x0077ff, warn:0xffaa00 };

// ══════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ══════════════════════════════════════════════════════════════════════════════
const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post a management panel for a script in this channel")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("upload")
    .setDescription("Upload a Lua script to PubArmour")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true))
    .addAttachmentOption(o=>o.setName("file").setDescription(".lua file").setRequired(false))
    .addStringOption(o=>o.setName("content").setDescription("Inline content").setRequired(false))
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
    .setDescription("Download raw .lua source")
    .addStringOption(o=>o.setName("name").setDescription("Script name").setRequired(true)),
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

function hasPerm(member) {
  if (!ALLOWED_ROLES.length) return false;
  return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
}

function ah() {
  return { "Content-Type": "application/json", "x-admin-password": UPLOAD_PASSWORD };
}

function denied() {
  return new EmbedBuilder().setColor(C.err).setTitle("🔒 Access Denied")
    .setDescription("You don't have the required role.")
    .setFooter({ text: "PubArmour" });
}

function statusEmoji(k) {
  if (k.revoked) return "🚫 Revoked";
  if (k.expired) return "⌛ Expired";
  if (k.active)  return "✅ Active";
  return "❓ Unknown";
}

// ══════════════════════════════════════════════════════════════════════════════
//  PANEL BUILDER
// ══════════════════════════════════════════════════════════════════════════════
function buildPanelEmbed(scriptName, s) {
  const loader = `Pub_key = "PA-XXXXXXXXXXXXXXXXXXXX"\nloadstring(game:HttpGet("${API_URL}/auth/${scriptName}?key="..Pub_key))()`;
  return new EmbedBuilder()
    .setColor(C.ok)
    .setTitle(`🛡️ PubArmour — ${scriptName}`)
    .setDescription(s?.description || "*No description*")
    .addFields(
      { name: "Lines",      value: String(s?.lines || "?"),              inline: true },
      { name: "Size",       value: ((s?.size||0)/1024).toFixed(1)+"KB",  inline: true },
      { name: "Executions", value: String(s?.executions || 0),           inline: true },
      { name: "Protection", value: s?.skipObfuscation ? "⚠️ Raw (HWID only)" : "🛡️ Full (Key+HWID+Token+XOR+Anti-dump)" },
      { name: "Loader",     value: `\`\`\`lua\n${loader}\n\`\`\`` },
    )
    .setFooter({ text: "PubArmour v2.1 • Use the buttons below" })
    .setTimestamp();
}

function buildPanelRows(scriptName) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pa_genkey_${scriptName}`).setLabel("Generate Key").setStyle(ButtonStyle.Success).setEmoji("🔑"),
    new ButtonBuilder().setCustomId(`pa_revokekey_${scriptName}`).setLabel("Revoke Key").setStyle(ButtonStyle.Danger).setEmoji("🚫"),
    new ButtonBuilder().setCustomId(`pa_resethwid_${scriptName}`).setLabel("Reset HWID").setStyle(ButtonStyle.Secondary).setEmoji("🔓"),
    new ButtonBuilder().setCustomId(`pa_deletekey_${scriptName}`).setLabel("Delete Key").setStyle(ButtonStyle.Danger).setEmoji("🗑️"),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pa_listkeys_${scriptName}`).setLabel("List Keys").setStyle(ButtonStyle.Primary).setEmoji("📋"),
    new ButtonBuilder().setCustomId(`pa_stats_${scriptName}`).setLabel("Stats").setStyle(ButtonStyle.Primary).setEmoji("📊"),
    new ButtonBuilder().setCustomId(`pa_resetexecs_${scriptName}`).setLabel("Reset Execs").setStyle(ButtonStyle.Secondary).setEmoji("🔄"),
    new ButtonBuilder().setCustomId(`pa_copyloader_${scriptName}`).setLabel("Copy Loader").setStyle(ButtonStyle.Secondary).setEmoji("📎"),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pa_checkkey_${scriptName}`).setLabel("Check Key").setStyle(ButtonStyle.Primary).setEmoji("🔍"),
    new ButtonBuilder().setCustomId(`pa_refresh_${scriptName}`).setLabel("Refresh Panel").setStyle(ButtonStyle.Secondary).setEmoji("↺"),
  );
  return [row1, row2, row3];
}

// ══════════════════════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ══════════════════════════════════════════════════════════════════════════════
client.on("interactionCreate", async interaction => {

  // ── SLASH COMMANDS ─────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply();
    if (!hasPerm(interaction.member)) return interaction.editReply({ embeds: [denied()] });

    const cmd = interaction.commandName;

    try {
      if (cmd === "panel") {
        const name = interaction.options.getString("name");
        const list = await (await fetch(`${API_URL}/api/scripts`)).json();
        const s    = list.find(x => x.name === name);
        if (!s) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ Script \`${name}\` not found. Upload it first.`)] });
        return interaction.editReply({ embeds: [buildPanelEmbed(name, s)], components: buildPanelRows(name) });
      }

      if (cmd === "upload") {
        const name   = interaction.options.getString("name");
        const desc   = interaction.options.getString("description") || "";
        const att    = interaction.options.getAttachment("file");
        const inline = interaction.options.getString("content");
        const skipObf = interaction.options.getBoolean("skip_obfuscation") || false;
        let content  = inline || "";
        if (att) {
          try { content = await (await fetch(att.url)).text(); }
          catch { return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Failed to fetch attachment.")] }); }
        }
        if (!content) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Provide a file or inline content.")] });
        const res  = await fetch(`${API_URL}/api/upload`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, name, content, description: desc, skipObfuscation: skipObf }) });
        const data = await res.json();
        if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
        const loader = `Pub_key = "PA-XXXXXXXXXXXXXXXXXXXX"\nloadstring(game:HttpGet("${API_URL}/auth/${data.name}?key="..Pub_key))()`;
        return interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(C.ok).setTitle("✅ Script Uploaded & Protected")
            .addFields(
              { name: "Name",        value: `\`${data.name}\``,                       inline: true },
              { name: "Status",      value: data.isNew ? "🆕 New" : "🔄 Updated",     inline: true },
              { name: "Obfuscation", value: skipObf ? "⚠️ Skipped" : "🛡️ Enabled",   inline: true },
              { name: "Loader",      value: `\`\`\`lua\n${loader}\n\`\`\`` },
            ).setFooter({ text: "Use /panel " + data.name + " to post a management panel" })
        ]});
      }

      if (cmd === "deletescript") {
        const name = interaction.options.getString("name");
        const res  = await fetch(`${API_URL}/api/scripts/${name}`, { method: "DELETE", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `🗑️ \`${name}\` deleted.` : "❌ " + data.error)] });
      }

      if (cmd === "listscripts") {
        const res  = await fetch(`${API_URL}/api/scripts`);
        const list = await res.json();
        if (!list.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setDescription("📭 No scripts.")] });
        const rows = list.map((s, i) =>
          `\`${String(i+1).padStart(2,"0")}\` **${s.name}** — ${s.lines} lines · ${(s.size/1024).toFixed(1)}KB · ▶ ${s.executions} runs${s.skipObfuscation ? ' ⚠️' : ' 🛡️'}${s.description ? `\n> ${s.description}` : ""}`
        ).join("\n\n");
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle(`🛡️ PubArmour — ${list.length} scripts`).setDescription(rows.slice(0, 4000))] });
      }

      if (cmd === "download") {
        const name = interaction.options.getString("name");
        const res  = await fetch(`${API_URL}/api/scripts/${name}/content`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
        const data = await res.json();
        if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
        const file = new AttachmentBuilder(Buffer.from(data.content, "utf8"), { name: `${name}.lua` });
        return interaction.editReply({ files: [file], embeds: [new EmbedBuilder().setColor(C.ok).setDescription(`⬇️ \`${name}.lua\``)] });
      }

    } catch (err) {
      console.error(`❌ Error in /${cmd}:`, err);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ Error: \`${err.message}\``)] });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  BUTTON HANDLER
  // ══════════════════════════════════════════════════════════════════════════
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (!id.startsWith("pa_")) return;
    if (!hasPerm(interaction.member)) return interaction.reply({ embeds: [denied()], ephemeral: true });

    const parts      = id.split("_");
    const action     = parts[1];
    const scriptName = parts.slice(2).join("_");

    try {
      // Buttons that open modals (can't defer before showModal)
      if (action === "genkey") {
        const modal = new ModalBuilder().setCustomId(`pm_genkey_${scriptName}`).setTitle("Generate Key");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("hours").setLabel("Duration (hours)").setStyle(TextInputStyle.Short).setPlaceholder("24").setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("note").setLabel("Note (e.g. username)").setStyle(TextInputStyle.Short).setPlaceholder("optional").setRequired(false)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("maxuses").setLabel("Max uses (blank = unlimited)").setStyle(TextInputStyle.Short).setPlaceholder("").setRequired(false)),
        );
        return interaction.showModal(modal);
      }

      if (action === "revokekey") {
        const modal = new ModalBuilder().setCustomId(`pm_revokekey_${scriptName}`).setTitle("Revoke Key");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("key").setLabel("Key to revoke").setStyle(TextInputStyle.Short).setPlaceholder("PA-...").setRequired(true)));
        return interaction.showModal(modal);
      }

      if (action === "resethwid") {
        const modal = new ModalBuilder().setCustomId(`pm_resethwid_${scriptName}`).setTitle("Reset HWID");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("key").setLabel("Key to reset HWID for").setStyle(TextInputStyle.Short).setPlaceholder("PA-...").setRequired(true)));
        return interaction.showModal(modal);
      }

      if (action === "deletekey") {
        const modal = new ModalBuilder().setCustomId(`pm_deletekey_${scriptName}`).setTitle("Delete Key");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("key").setLabel("Key to delete").setStyle(TextInputStyle.Short).setPlaceholder("PA-...").setRequired(true)));
        return interaction.showModal(modal);
      }

      if (action === "checkkey") {
        const modal = new ModalBuilder().setCustomId(`pm_checkkey_${scriptName}`).setTitle("Check Key");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("key").setLabel("Key to check").setStyle(TextInputStyle.Short).setPlaceholder("PA-...").setRequired(true)));
        return interaction.showModal(modal);
      }

      // Buttons that respond directly
      if (action === "listkeys") {
        await interaction.deferReply({ ephemeral: true });
        const res  = await fetch(`${API_URL}/api/keys/list`, { headers: { "x-admin-password": UPLOAD_PASSWORD } });
        const list = await res.json();
        if (!list.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setDescription("No keys found.")] });
        const rows = list.slice(0, 25).map((k, i) =>
          `\`${String(i+1).padStart(2,"0")}\` \`${k.key}\` ${statusEmoji(k)} | HWID: ${k.hwid_bound ? "🔒" : "🔓"} | Uses: ${k.uses}${k.maxUses ? "/"+k.maxUses : ""} | Exp: ${k.expires.slice(0,10)}${k.note ? " | "+k.note : ""}`
        ).join("\n");
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle(`🔑 Keys (${list.length})`).setDescription(rows.slice(0, 4000))] });
      }

      if (action === "stats") {
        await interaction.deferReply({ ephemeral: true });
        const res  = await fetch(`${API_URL}/api/stats`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
        const data = await res.json();
        if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
        const size = data.totalSize < 1024 ? data.totalSize+"B" : (data.totalSize/1024).toFixed(1)+"KB";
        return interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(C.ok).setTitle("📊 PubArmour Statistics")
            .addFields(
              { name: "Scripts",     value: String(data.scriptCount),              inline: true },
              { name: "Executions",  value: data.totalExecutions.toLocaleString(), inline: true },
              { name: "Storage",     value: size,                                  inline: true },
              { name: "Active Keys", value: String(data.activeKeys),               inline: true },
              { name: "Total Keys",  value: String(data.totalKeys),                inline: true },
            )
        ]});
      }

      if (action === "resetexecs") {
        await interaction.deferReply({ ephemeral: true });
        const res  = await fetch(`${API_URL}/api/scripts/${scriptName}/reset-execs`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `✅ Exec counter reset for \`${scriptName}\`.` : "❌ " + data.error)] });
      }

      if (action === "copyloader") {
        const loader = `Pub_key = "PA-XXXXXXXXXXXXXXXXXXXX"\nloadstring(game:HttpGet("${API_URL}/auth/${scriptName}?key="..Pub_key))()`;
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(C.info).setTitle(`📎 Loader for ${scriptName}`).setDescription(`\`\`\`lua\n${loader}\n\`\`\``)],
          ephemeral: true
        });
      }

      if (action === "refresh") {
        await interaction.deferUpdate();
        const list = await (await fetch(`${API_URL}/api/scripts`)).json();
        const s    = list.find(x => x.name === scriptName);
        if (!s) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ \`${scriptName}\` no longer exists.`)], components: [] });
        return interaction.editReply({ embeds: [buildPanelEmbed(scriptName, s)], components: buildPanelRows(scriptName) });
      }

    } catch (err) {
      console.error(`❌ Button [${action}]:`, err);
      if (!interaction.replied && !interaction.deferred) return interaction.reply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ ${err.message}`)], ephemeral: true });
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ ${err.message}`)] });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MODAL SUBMIT HANDLER
  // ══════════════════════════════════════════════════════════════════════════
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;
    if (!id.startsWith("pm_")) return;
    if (!hasPerm(interaction.member)) return interaction.reply({ embeds: [denied()], ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const withoutPrefix = id.slice(3); // remove "pm_"
    const firstUnderscore = withoutPrefix.indexOf("_");
    const action     = withoutPrefix.slice(0, firstUnderscore);
    const scriptName = withoutPrefix.slice(firstUnderscore + 1);

    try {
      if (action === "genkey") {
        const hours   = parseInt(interaction.fields.getTextInputValue("hours"));
        const note    = interaction.fields.getTextInputValue("note") || "";
        const maxRaw  = interaction.fields.getTextInputValue("maxuses");
        const maxUses = maxRaw ? parseInt(maxRaw) : null;
        if (isNaN(hours) || hours < 1) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Hours must be ≥ 1.")] });

        const res  = await fetch(`${API_URL}/api/keys/generate`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, duration_hours: hours, note, maxUses }) });
        const data = await res.json();
        if (data.error) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ " + data.error)] });
        return interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(C.ok).setTitle("🔑 Key Generated")
            .addFields(
              { name: "Key",      value: `\`${data.key}\`` },
              { name: "Duration", value: `${hours}h`, inline: true },
              { name: "Max Uses", value: maxUses ? String(maxUses) : "∞", inline: true },
              { name: "Expires",  value: data.expires },
              { name: "Note",     value: note || "—" }
            )
        ]});
      }

      if (action === "revokekey") {
        const key  = interaction.fields.getTextInputValue("key").trim();
        const res  = await fetch(`${API_URL}/api/keys/revoke`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, key }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `🚫 \`${key}\` revoked.` : "❌ " + data.error)] });
      }

      if (action === "resethwid") {
        const key  = interaction.fields.getTextInputValue("key").trim();
        const res  = await fetch(`${API_URL}/api/keys/reset-hwid`, { method: "POST", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, key }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `✅ HWID cleared for \`${key}\`.` : "❌ " + data.error)] });
      }

      if (action === "deletekey") {
        const key  = interaction.fields.getTextInputValue("key").trim();
        const res  = await fetch(`${API_URL}/api/keys/delete`, { method: "DELETE", headers: ah(), body: JSON.stringify({ password: UPLOAD_PASSWORD, key }) });
        const data = await res.json();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(data.success ? C.ok : C.err)
          .setDescription(data.success ? `🗑️ \`${key}\` deleted.` : "❌ " + data.error)] });
      }

      if (action === "checkkey") {
        const key  = interaction.fields.getTextInputValue("key").trim();
        const list = await (await fetch(`${API_URL}/api/keys/list`, { headers: { "x-admin-password": UPLOAD_PASSWORD } })).json();
        const k    = list.find(x => x.key === key);
        if (!k) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription("❌ Key not found.")] });
        return interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(k.active ? C.ok : C.err).setTitle("🔑 Key Info")
            .addFields(
              { name: "Key",     value: `\`${k.key}\`` },
              { name: "Status",  value: statusEmoji(k),                                   inline: true },
              { name: "HWID",    value: k.hwid_bound ? "🔒 Bound" : "🔓 Unbound",         inline: true },
              { name: "Uses",    value: `${k.uses}${k.maxUses ? "/"+k.maxUses : " (∞)"}`, inline: true },
              { name: "Expires", value: k.expires },
              { name: "Note",    value: k.note || "—" }
            )
        ]});
      }

    } catch (err) {
      console.error(`❌ Modal [${action}]:`, err);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.err).setDescription(`❌ ${err.message}`)] });
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  STARTUP
// ══════════════════════════════════════════════════════════════════════════════
client.once("ready", () => console.log(`🛡️ PubArmour bot ready: ${client.user.tag}`));
client.on("error", err => console.error("❌ Discord client error:", err));
process.on("unhandledRejection", err => console.error("❌ Unhandled rejection:", err));

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => { console.error("❌ Startup failed:", err); process.exit(1); });
