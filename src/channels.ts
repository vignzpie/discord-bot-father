import {
  Client,
  GatewayIntentBits,
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type Guild,
  type CategoryChannel,
  type TextChannel,
  type OverwriteResolvable,
} from 'discord.js';
import type { Config } from './config.schema.js';
import type { BotMeta } from './validate.js';
import { log } from './logger.js';

// ── Lightweight pre-flight check (REST API, no full client login) ──

export interface ExistingChannelStatus {
  allExist: boolean;
  channelMap: Map<string, Map<string, string>>; // guildId → (channelName → channelId)
  missing: string[];
  found: number;
  total: number;
}

interface DiscordAPIChannel {
  id: string;
  name: string;
  type: number; // 0 = GuildText, 4 = GuildCategory
  parent_id: string | null;
}

export async function checkExistingChannels(
  config: Config,
  adminToken: string,
): Promise<ExistingChannelStatus> {
  const allExpectedNames = [
    ...config.agents.flatMap((a) => a.channels),
    ...config.sharedChannels.map((s) => s.name),
  ];

  const channelMap = new Map<string, Map<string, string>>();
  const missing: string[] = [];
  let found = 0;

  for (const guildId of config.guilds) {
    const guildMap = new Map<string, string>();

    try {
      const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
        headers: { Authorization: `Bot ${adminToken}` },
      });

      if (!res.ok) {
        // Bot not in guild or permissions issue — all channels missing
        for (const name of allExpectedNames) missing.push(name);
        channelMap.set(guildId, guildMap);
        continue;
      }

      const guildChannels: DiscordAPIChannel[] = await res.json();

      // Find the category
      const category = guildChannels.find(
        (ch) => ch.type === 4 && ch.name === config.categoryName,
      );

      for (const name of allExpectedNames) {
        const ch = category
          ? guildChannels.find(
              (c) => c.type === 0 && c.name === name && c.parent_id === category.id,
            )
          : undefined;

        if (ch) {
          guildMap.set(name, ch.id);
          found++;
        } else {
          missing.push(name);
        }
      }
    } catch {
      // Network error — treat all as missing
      for (const name of allExpectedNames) missing.push(name);
    }

    channelMap.set(guildId, guildMap);
  }

  const total = allExpectedNames.length * config.guilds.length;

  return { allExist: found === total, channelMap, missing, found, total };
}

// ── Full channel setup (discord.js client) ──

export async function setupGuildChannels(
  config: Config,
  botMeta: Map<string, BotMeta>,
  clean = false,
): Promise<Map<string, Map<string, string>>> {
  const adminAgent = config.agents[0];
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  const readyPromise = new Promise<void>((r) => client.once('ready', () => r()));
  await client.login(adminAgent.botToken);
  await readyPromise;

  const result = new Map<string, Map<string, string>>();

  try {
    for (const guildId of config.guilds) {
      log.step(`Setting up guild ${guildId}`);
      const guild = await client.guilds.fetch(guildId);
      await guild.channels.fetch();
      const channelMap = await setupGuild(guild, config, botMeta, clean);
      result.set(guildId, channelMap);
    }
  } finally {
    client.destroy();
  }

  return result;
}

function archiveTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function archiveChannel(channel: TextChannel): Promise<void> {
  const stamp = archiveTimestamp();
  const newName = `archive-${stamp}-${channel.name}`;
  log.warn(`  Archiving #${channel.name} => #${newName}`);
  await channel.setName(newName);
}

async function setupGuild(
  guild: Guild,
  config: Config,
  botMeta: Map<string, BotMeta>,
  clean: boolean,
): Promise<Map<string, string>> {
  const channelMap = new Map<string, string>();

  const category = await findOrCreateCategory(guild, config.categoryName);

  const allBotUserIds = [...botMeta.values()].map((m) => m.userId);

  // Agent-owned channels
  for (const agent of config.agents) {
    const meta = botMeta.get(agent.name);
    if (!meta) {
      log.warn(`  Skipping ${agent.name} — no validated token`);
      continue;
    }

    const allowPerms = resolvePermissions(agent.permissions);

    for (const channelName of agent.channels) {
      const overwrites: OverwriteResolvable[] = [
        { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        { id: meta.userId, type: OverwriteType.Member, allow: allowPerms },
      ];

      for (const otherId of allBotUserIds) {
        if (otherId !== meta.userId) {
          overwrites.push({ id: otherId, type: OverwriteType.Member, deny: [PermissionFlagsBits.ViewChannel] });
        }
      }

      const channel = await findOrCreateTextChannel(guild, channelName, category, overwrites, clean);
      channelMap.set(channelName, channel.id);
      log.info(`  #${channelName} => ${channel.id}`);
    }
  }

  // Shared channels
  for (const shared of config.sharedChannels) {
    const accessBotIds = shared.agentAccess
      .map((name) => botMeta.get(name)?.userId)
      .filter((id): id is string => id !== undefined);

    const overwrites: OverwriteResolvable[] = [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ];

    for (const botId of allBotUserIds) {
      if (accessBotIds.includes(botId)) {
        overwrites.push({
          id: botId,
          type: OverwriteType.Member,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        });
      } else {
        overwrites.push({ id: botId, type: OverwriteType.Member, deny: [PermissionFlagsBits.ViewChannel] });
      }
    }

    const channel = await findOrCreateTextChannel(guild, shared.name, category, overwrites, clean);
    channelMap.set(shared.name, channel.id);
    log.info(`  #${shared.name} (shared) => ${channel.id}`);
  }

  return channelMap;
}

async function findOrCreateCategory(guild: Guild, name: string): Promise<CategoryChannel> {
  const existing = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name === name,
  ) as CategoryChannel | undefined;

  if (existing) {
    log.info(`  Found existing category: ${name}`);
    return existing;
  }

  log.info(`  Creating category: ${name}`);
  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
  });
}

async function findOrCreateTextChannel(
  guild: Guild,
  name: string,
  parent: CategoryChannel,
  permissionOverwrites: OverwriteResolvable[],
  clean: boolean,
): Promise<TextChannel> {
  const existing = guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      ch.name === name &&
      ch.parentId === parent.id,
  ) as TextChannel | undefined;

  if (existing) {
    if (clean) {
      // Archive the old channel, then create a fresh one
      await archiveChannel(existing);
    } else {
      // Idempotent: update permissions in place
      await existing.permissionOverwrites.set(permissionOverwrites);
      return existing;
    }
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites,
  });
}

function resolvePermissions(permNames: string[]): bigint[] {
  return permNames.map((name) => {
    const flag = PermissionFlagsBits[name as keyof typeof PermissionFlagsBits];
    if (flag === undefined) {
      throw new Error(`Unknown permission: "${name}"`);
    }
    return flag;
  });
}
