import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config } from './config.schema.js';
import type { BotMeta } from './validate.js';
import { log } from './logger.js';

export function writeOutputFiles(
  config: Config,
  botMeta: Map<string, BotMeta>,
  channelMap: Map<string, Map<string, string>>,
  inviteUrls: Map<string, string>,
): void {
  mkdirSync(dirname(config.output.envFile), { recursive: true });

  // Combined .env
  const envLines: string[] = [];
  for (const agent of config.agents) {
    const prefix = agent.envPrefix;
    envLines.push(`# ${agent.name}`);
    const meta = botMeta.get(agent.name);
    envLines.push(`${prefix}_BOT_TOKEN=${agent.botToken}`);
    envLines.push(`${prefix}_APPLICATION_ID=${meta?.applicationId ?? 'UNKNOWN'}`);

    for (const [guildId, channels] of channelMap) {
      const guildSuffix = channelMap.size > 1 ? `_G${guildId.slice(-4)}` : '';
      for (const chName of agent.channels) {
        const chId = channels.get(chName);
        if (chId) {
          const envKey = `${prefix}_CHANNEL_${chName.toUpperCase().replace(/-/g, '_')}${guildSuffix}`;
          envLines.push(`${envKey}=${chId}`);
        }
      }
    }
    envLines.push('');
  }

  writeFileSync(config.output.envFile, envLines.join('\n'));
  log.success(`Written ${config.output.envFile}`);

  // Per-agent .env files
  if (config.output.perAgentEnvFiles) {
    for (const agent of config.agents) {
      const agentEnvPath = config.output.envFile.replace('.env', `.${agent.name}.env`);
      const agentLines: string[] = [];
      const prefix = agent.envPrefix;

      const agentMeta = botMeta.get(agent.name);
      agentLines.push(`${prefix}_BOT_TOKEN=${agent.botToken}`);
      agentLines.push(`${prefix}_APPLICATION_ID=${agentMeta?.applicationId ?? 'UNKNOWN'}`);

      for (const [guildId, channels] of channelMap) {
        const guildSuffix = channelMap.size > 1 ? `_G${guildId.slice(-4)}` : '';
        for (const chName of agent.channels) {
          const chId = channels.get(chName);
          if (chId) {
            const envKey = `${prefix}_CHANNEL_${chName.toUpperCase().replace(/-/g, '_')}${guildSuffix}`;
            agentLines.push(`${envKey}=${chId}`);
          }
        }
      }

      writeFileSync(agentEnvPath, agentLines.join('\n') + '\n');
      log.success(`Written ${agentEnvPath}`);
    }
  }

  // Summary markdown
  const summary = generateSummary(config, botMeta, channelMap, inviteUrls);
  mkdirSync(dirname(config.output.summaryFile), { recursive: true });
  writeFileSync(config.output.summaryFile, summary);
  log.success(`Written ${config.output.summaryFile}`);
}

function generateSummary(
  config: Config,
  botMeta: Map<string, BotMeta>,
  channelMap: Map<string, Map<string, string>>,
  inviteUrls: Map<string, string>,
): string {
  const lines: string[] = [
    `# ${config.categoryName} — Setup Summary`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Invite URLs',
    '',
    'Click each link to add the bot to your server:',
    '',
  ];

  for (const agent of config.agents) {
    const meta = botMeta.get(agent.name);
    const username = meta?.username ?? 'unknown';
    lines.push(`- **${agent.name}** (${username}): [Invite](${inviteUrls.get(agent.name)})`);
  }

  lines.push('', '## Channels', '');
  for (const [guildId, channels] of channelMap) {
    lines.push(`### Guild: ${guildId}`);
    lines.push('');
    for (const [name, id] of channels) {
      lines.push(`- \`#${name}\` — \`${id}\``);
    }
    lines.push('');
  }

  lines.push('## Agents', '');
  for (const agent of config.agents) {
    const meta = botMeta.get(agent.name);
    lines.push(`### ${agent.name}`);
    lines.push(`- Bot: ${meta?.username ?? 'unknown'} (\`${meta?.userId ?? '?'}\`)`);
    lines.push(`- Channels: ${agent.channels.map((c) => `#${c}`).join(', ')}`);
    lines.push(`- Permissions: ${agent.permissions.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function sanitizeConfigFile(configPath: string): void {
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Replace guild IDs
  if (Array.isArray(raw.guilds)) {
    raw.guilds = raw.guilds.map((_: string, i: number) =>
      raw.guilds.length === 1 ? 'YOUR_GUILD_ID' : `YOUR_GUILD_ID_${i + 1}`,
    );
  }

  // Replace bot tokens
  if (Array.isArray(raw.agents)) {
    for (const agent of raw.agents) {
      const name = (agent.name ?? 'BOT').toUpperCase();
      agent.botToken = `YOUR_${name}_BOT_TOKEN`;
    }
  }

  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n');
  log.success(`Sanitized ${configPath} — tokens replaced with placeholders`);

  // Generate a generic config.example.json from the real config structure
  const examplePath = configPath.replace(/config\.json$/, 'config.example.json');
  if (examplePath !== configPath) {
    writeGenericExample(examplePath, raw);
  }
}

function writeGenericExample(examplePath: string, sanitized: Record<string, unknown>): void {
  const example = {
    guilds: ['YOUR_GUILD_ID'],
    categoryName: 'My Agents',
    agents: [
      {
        name: 'admin-bot',
        botToken: 'YOUR_ADMIN_BOT_TOKEN',
        channels: ['admin-log'],
        permissions: ['ManageChannels', 'ManageRoles', 'SendMessages', 'ReadMessageHistory', 'ViewChannel'],
        envPrefix: 'ADMIN',
      },
      {
        name: 'worker-bot',
        botToken: 'YOUR_WORKER_BOT_TOKEN',
        channels: ['worker-log'],
        permissions: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
        envPrefix: 'WORKER',
      },
    ],
    sharedChannels: [
      {
        name: 'general-comms',
        agentAccess: ['admin-bot', 'worker-bot'],
      },
    ],
    output: {
      envFile: './output/.env',
      perAgentEnvFiles: true,
      summaryFile: './output/setup-summary.md',
    },
  };

  writeFileSync(examplePath, JSON.stringify(example, null, 2) + '\n');
  log.success(`Written generic ${examplePath}`);
}
