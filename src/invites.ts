import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import type { AgentConfig } from './config.schema.js';
import type { BotMeta } from './validate.js';

export function generateInviteUrls(
  agents: AgentConfig[],
  botMeta: Map<string, BotMeta>,
): Map<string, string> {
  const urls = new Map<string, string>();

  for (const agent of agents) {
    const meta = botMeta.get(agent.name);
    if (!meta) continue;

    const bits = new PermissionsBitField();
    for (const perm of agent.permissions) {
      bits.add(PermissionFlagsBits[perm as keyof typeof PermissionFlagsBits]);
    }

    const url = `https://discord.com/oauth2/authorize?client_id=${meta.applicationId}&permissions=${bits.bitfield.toString()}&scope=bot`;
    urls.set(agent.name, url);
  }

  return urls;
}
