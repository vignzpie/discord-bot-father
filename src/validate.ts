import { Client, GatewayIntentBits } from 'discord.js';
import type { AgentConfig } from './config.schema.js';
import { log } from './logger.js';

export interface BotMeta {
  userId: string;
  applicationId: string;
  username: string;
  inGuilds: Set<string>;
}

export async function validateAllTokens(
  agents: AgentConfig[],
  guildIds: string[],
): Promise<Map<string, BotMeta>> {
  const results = new Map<string, BotMeta>();

  for (const agent of agents) {
    log.info(`  Validating ${agent.name}...`);
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    try {
      // Attach ready listener BEFORE login to avoid race condition
      const readyPromise = new Promise<void>((resolve, reject) => {
        client.once('ready', () => resolve());
        setTimeout(() => reject(new Error(`Timeout waiting for ${agent.name} to be ready`)), 30_000);
      });

      await client.login(agent.botToken);
      await readyPromise;

      const user = client.user!;
      const applicationId = client.application?.id ?? user.id;

      const inGuilds = new Set<string>();
      for (const guildId of guildIds) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          inGuilds.add(guildId);
        } else {
          log.warn(`    ${agent.name} is not yet in guild ${guildId} — invite needed`);
        }
      }

      results.set(agent.name, { userId: user.id, applicationId, username: user.tag, inGuilds });
      log.success(`  ${agent.name} => ${user.tag} (app: ${applicationId})`);
    } catch (err) {
      throw new Error(`Token validation failed for "${agent.name}": ${err}`);
    } finally {
      client.destroy();
    }
  }

  return results;
}
