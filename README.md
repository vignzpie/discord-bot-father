# discord-bot-father

Automated setup for multi-agent Discord bots. Creates bot channels, sets permissions, generates invite URLs, and outputs `.env` files — all from a single JSON config.

Built for multi-agent deployments where each AI agent runs as a separate Discord bot.

### TL;DR

You have multiple Discord bots that need private channels, locked permissions, and `.env` files. Instead of clicking through Discord's UI for each one:

```bash
npm install
cp config.example.json config.json   # add your bot tokens + guild ID
npm run setup:dry                     # validate everything, get invite URLs
npm run setup                         # create channels, set permissions, generate .env files
```

One config, one command, all bots wired up. Idempotent — safe to re-run. See **Setup guide** below for the full walkthrough.

## What it automates

- Validates all bot tokens against the Discord API
- Creates a channel category with per-agent and shared channels
- Sets channel permission lockdowns (each bot only sees its own channels + shared ones)
- Generates OAuth2 invite URLs with correct permission bitfields
- Outputs `.env` files ready for Docker/agent consumption

## What requires manual steps

Discord does not allow programmatic bot creation — each bot application must be created through the [Developer Portal](https://discord.com/developers/applications). This tool automates everything after that.

## Prerequisites

- Node.js 18+ (install via [asdf](https://asdf-vm.com/): `asdf plugin add nodejs && asdf install nodejs latest`)
- A Discord server where you have admin privileges
- Bot applications created in the Discord Developer Portal (see setup guide below)

## Quick start

```bash
npm install
cp config.example.json config.json
# Fill in bot tokens and guild ID (see setup guide)
npm run setup
```

## Setup guide

### 1. Create bot applications

For each agent, repeat these steps in the [Discord Developer Portal](https://discord.com/developers/applications):

1. Click **New Application** and name it
2. Go to the **Bot** tab
3. Click **Reset Token** and copy it (shown only once — save it immediately)
4. Scroll to **Privileged Gateway Intents** and enable all three:
   - Message Content Intent
   - Server Members Intent
   - Presence Intent
5. Save changes

The first bot in your config acts as the **setup bot** — the script logs in as this bot to create channels and set permissions. It needs at minimum `ManageChannels` + `ManageRoles` in the guild. If your use case requires it (e.g. an orchestrator bot that manages the server at runtime), you can give it `Administrator` instead — but the script itself only needs those two.

### 2. Get your Guild (Server) ID

1. In Discord, go to **Settings > Advanced** and enable **Developer Mode**
2. Right-click your server name in the sidebar
3. Click **Copy Server ID**

### 3. Fill in config.json

Copy `config.example.json` to `config.json` and fill in:

- `guilds` — your server ID(s)
- `botToken` for each agent — from step 1
- Adjust `channels`, `permissions`, `sharedChannels` as needed

You do **not** need to provide application IDs — they are auto-detected from the bot tokens.

### 4. Dry run (validate without creating anything)

```bash
npm run setup:dry
```

This validates your config and all bot tokens, then prints invite URLs. No channels are created.

### 5. Invite bots to your server

The dry run prints OAuth2 invite URLs for each bot. Click each URL, select your server, and authorize. **Invite the admin bot first.**

### 6. Run the full setup

```bash
npm run setup
```

This creates channels, sets permissions, and generates output files.

## Config reference

```json
{
  "guilds": ["SERVER_ID"],
  "categoryName": "My Agents",
  "agents": [
    {
      "name": "my-bot",
      "botToken": "TOKEN_FROM_DEVELOPER_PORTAL",
      "channels": ["my-bot"],
      "permissions": ["SendMessages", "ReadMessageHistory", "ViewChannel"],
      "envPrefix": "MY_BOT"
    }
  ],
  "sharedChannels": [
    {
      "name": "team-chat",
      "agentAccess": ["my-bot", "other-bot"]
    }
  ],
  "output": {
    "envFile": "./output/.env",
    "perAgentEnvFiles": true,
    "summaryFile": "./output/setup-summary.md"
  }
}
```

| Field | Description |
|-------|-------------|
| `guilds` | Array of Discord server IDs (supports multi-server) |
| `categoryName` | Name of the channel category to create |
| `agents[].name` | Lowercase alphanumeric agent identifier |
| `agents[].botToken` | Bot token from the Developer Portal |
| `agents[].channels` | Channel names this bot owns (private to it) |
| `agents[].permissions` | Discord permission names (e.g. `SendMessages`, `Administrator`) |
| `agents[].envPrefix` | Prefix for env variable names (e.g. `MY_BOT` -> `MY_BOT_BOT_TOKEN`) |
| `sharedChannels` | Channels accessible by multiple bots |
| `output.envFile` | Path for the combined `.env` file |
| `output.perAgentEnvFiles` | Generate individual `.env` files per agent |
| `output.summaryFile` | Path for the markdown summary |

## Run modes

| Command | Description |
|---------|-------------|
| `npm run setup` | Create/update channels and permissions (idempotent) |
| `npm run setup:dry` | Validate config and tokens only, no mutations |
| `npm run setup:clean` | Archive existing channels and create fresh ones |

## What your Discord server will look like

After running the setup, your server sidebar will have a new category with private channels:

```
📁 My Agents                    ← category (from categoryName)
   #admin-bot                   ← only admin-bot can see this
   #worker-bot                  ← only worker-bot can see this
   #general-comms               ← shared: both bots can see this
```

- Regular server members (`@everyone`) **cannot see any of these channels**
- Each bot **only sees its own channel(s) + shared channels it's listed in**
- Other bots **cannot see channels they're not assigned to**

For example, with a 4-bot AI team config:

```
📁 AI Agents
   #orchestrator                ← only orchestrator
   #researcher                  ← only researcher
   #coder                       ← only coder
   #reviewer                    ← only reviewer
   #team-comms                  ← all 4 bots
   #code-reviews                ← coder + reviewer only
```

The orchestrator cannot read `#code-reviews`. The researcher cannot read `#coder`. Each bot is isolated to its own workspace, with shared channels as explicit bridges.

## How it works

### Channel permissions

**Per-agent channels:**
- `@everyone` — denied `ViewChannel`
- Owning bot — allowed configured permissions
- All other bots — denied `ViewChannel`

**Shared channels:**
- `@everyone` — denied `ViewChannel`
- Listed bots — allowed `ViewChannel`, `SendMessages`, `ReadMessageHistory`
- Unlisted bots — denied `ViewChannel`

### Idempotency

Running `npm run setup` multiple times is safe:
- Channels are matched by name + parent category
- If a channel already exists, its permissions are updated (not duplicated)
- Re-runs fix permission drift

### Clean mode

`npm run setup:clean` renames existing channels to `archive-YYYYMMDD-HHMMSS-channelname` before creating fresh ones. Old messages are preserved in the archived channels.

### Output

The script generates:
- `output/.env` — combined env file with all tokens and channel IDs
- `output/.{agent}.env` — per-agent env files (when `perAgentEnvFiles: true`)
- `output/setup-summary.md` — markdown summary with invite URLs and channel mappings

Example `.env` output:
```env
# my-bot
MY_BOT_BOT_TOKEN=your-token-here...
MY_BOT_APPLICATION_ID=123456789012345678
MY_BOT_CHANNEL_MY_BOT=987654321098765432
```

### Config sanitization

After a successful run, the script automatically:

1. **Sanitizes `config.json`** — replaces all bot tokens with `YOUR_<NAME>_BOT_TOKEN` placeholders and guild IDs with `YOUR_GUILD_ID`. Your real tokens are safe in the generated `output/.env` files.
2. **Regenerates `config.example.json`** — writes a generic two-bot example (admin-bot + worker-bot) so the example file never contains project-specific details.

This happens only when all 5 phases complete successfully. If any phase fails, your config is left untouched.

To re-run after sanitization, paste your tokens back into `config.json` (or copy them from `output/.env`).

## Agent instructions

This section is for AI agents (LLMs, copilots, local models) running this tool on behalf of a user. The **Setup guide**, **Config reference**, and **How it works** sections above are your primary reference — refer back to them, do not duplicate.

### Hard rules

1. **NEVER display bot tokens.** Say "token is configured" — never show the value.
2. **NEVER commit `config.json` or `output/`.** Both contain secrets.
3. **NEVER skip the dry run.** Always `npm run setup:dry` before `npm run setup`.
4. **NEVER fabricate tokens, guild IDs, or application IDs.** Ask the user.
5. **NEVER retry failed runs in a loop.** Diagnose first, fix, then retry once.

### Phase 1: Prerequisites

Verify before doing anything else. Do not proceed until all pass.

```bash
node --version   # must be v18.x or higher
npm --version    # must exist
ls package.json  # must be in discord-bot-father directory
npm install      # install dependencies
```

If Node.js is missing, ask the user how they manage runtimes (nvm, asdf, brew, etc.) — do not install without asking.

### Phase 2: Interactive config building

Do NOT hand the user a template and tell them to fill it in. Build the config interactively through conversation.

**Step 1 — Understand their setup.** Ask:
- "How many bots do you need?"
- "What are their names and roles?" (e.g. orchestrator, researcher, coder)
- "Do any bots need to talk to each other? Which ones share channels?"
- "What should the Discord category be called?"

**Step 2 — Determine permissions.** For each bot, ask:
- "What does this bot need to do?" Then map their answer to discord.js permission names:
  - Sends messages → `SendMessages`, `ViewChannel`
  - Reads history → `ReadMessageHistory`
  - Posts embeds/rich content → `EmbedLinks`
  - Uploads files/images → `AttachFiles`
  - Manages the server → `Administrator` (only if they explicitly need it)
- The **first bot** in the config is the setup bot. It needs `ManageChannels` + `ManageRoles` at minimum. Ask: "Which bot should manage the Discord setup? That one goes first."

**Step 3 — Generate config.json with placeholders.** Based on their answers, write `config.json` with the correct structure but placeholder values for secrets:

```json
{
  "guilds": ["YOUR_GUILD_ID"],
  "categoryName": "Their Category Name",
  "agents": [
    {
      "name": "their-bot-name",
      "botToken": "YOUR_THEIR_BOT_NAME_BOT_TOKEN",
      "channels": ["their-bot-name"],
      "permissions": ["the", "permissions", "you", "determined"],
      "envPrefix": "THEIR_BOT_NAME"
    }
  ],
  "sharedChannels": [...]
}
```

Validation rules for the config you generate:
- `name`: lowercase + hyphens only (`my-bot`, not `My Bot` or `my_bot`)
- `envPrefix`: UPPER_SNAKE_CASE, unique per agent
- `permissions`: PascalCase discord.js `PermissionFlagsBits` names
- Channel names: unique across entire config
- `sharedChannels[].agentAccess`: must match `agents[].name` exactly

**Step 4 — Walk user through secrets.** Now ask the user to replace placeholders with real values. One at a time:

1. "Go to Discord > Settings > Advanced > enable Developer Mode. Right-click your server name > Copy Server ID. Paste it here."
   → Update `guilds` in config.json.

2. For each bot: "Go to https://discord.com/developers/applications. Create a new application named `<name>`. Go to Bot tab > Reset Token > copy it. Also enable all three Privileged Gateway Intents (Message Content, Server Members, Presence). Paste the token here."
   → Update that agent's `botToken` in config.json.
   → Do not rush — tokens are shown only once. Wait for each one.

### Phase 3: Dry run and preview

```bash
npm run setup:dry
```

This validates the config, all tokens, and prints a **channel preview** showing exactly what the Discord server will look like:

```
Channel preview:
  📁 AI Agents
     #orchestrator  ← orchestrator only
     #researcher  ← researcher only
     #team-comms  ← shared: orchestrator, researcher
```

**Show this output to the user and ask: "Does this channel layout look right?"** Do not fabricate or paraphrase the preview — show the actual script output. If the user wants changes, update `config.json` and re-run the dry run.

If any bot shows "not yet in guild", give the user the printed invite URL and wait for them to authorize it. Then re-run.

Do NOT proceed to Phase 4 until the dry run passes cleanly and the user approves the preview.

### Phase 4: Full setup

```bash
npm run setup
```

Then verify:
```bash
ls output/
```

Expected: `.env`, per-agent `.env` files (if enabled), and `setup-summary.md`.

### Phase 5: Post-setup

After success, `config.json` is auto-sanitized (tokens replaced with placeholders). This is intentional — tokens are preserved in `output/.env`. See **Config sanitization** above.

To re-run later (e.g. adding a new bot), copy tokens back from `output/.env` into `config.json`.

### Troubleshooting

| Error | Fix |
|-------|-----|
| `Token validation failed for "X"` | Ask user for a fresh token from the Developer Portal |
| `Timeout waiting for X to be ready` | Retry once. If persistent, ask user to check bot status in portal |
| `X is not yet in guild Y` | Warning, not fatal. Give user the invite URL, wait, re-run |
| `Missing Permissions` (50013) | Setup bot needs ManageChannels + ManageRoles. Re-invite or assign role |
| `Unknown permissions: X` | Typo — error message lists all valid names |
| `Config file not found` | You skipped Phase 2 — build the config first |
| Any Zod validation error | Read the message — it tells you exactly which field and why |

## Security

- `config.json` and `output/` are in `.gitignore` — never commit bot tokens
- After a successful run, `config.json` is auto-sanitized (tokens removed) as an extra safety net
- Reset tokens in the Developer Portal if they are accidentally exposed
- The setup bot (first in config) has elevated permissions (`ManageChannels`, `ManageRoles`) — keep its token secure
