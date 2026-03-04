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
