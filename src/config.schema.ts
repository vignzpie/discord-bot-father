import { z } from 'zod';
import { PermissionFlagsBits } from 'discord.js';

const validPermissions = Object.keys(PermissionFlagsBits);

const AgentSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Agent name must be lowercase alphanumeric with hyphens'),
  botToken: z.string().min(50, 'Bot token looks too short — get it from the Discord Developer Portal'),
  channels: z.array(z.string().min(1)).min(1, 'Each agent needs at least one channel'),
  permissions: z.array(z.string()).min(1).refine(
    (perms) => perms.every((p) => validPermissions.includes(p)),
    (perms) => ({
      message: `Unknown permissions: ${perms.filter((p) => !validPermissions.includes(p)).join(', ')}. Valid: ${validPermissions.join(', ')}`,
    }),
  ),
  envPrefix: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'envPrefix must be UPPER_SNAKE_CASE'),
});

const SharedChannelSchema = z.object({
  name: z.string().min(1),
  agentAccess: z.array(z.string()).min(1),
});

const OutputSchema = z.object({
  envFile: z.string().default('./output/.env'),
  perAgentEnvFiles: z.boolean().default(false),
  summaryFile: z.string().default('./output/setup-summary.md'),
});

export const ConfigSchema = z.object({
  guilds: z.array(z.string().regex(/^\d+$/)).min(1, 'At least one guild ID is required'),
  categoryName: z.string().default('My Agents'),
  agents: z.array(AgentSchema).min(1, 'At least one agent is required'),
  sharedChannels: z.array(SharedChannelSchema).default([]),
  output: OutputSchema.default({}),
}).refine(
  (config) => {
    // Check all channel names are unique across agents and shared channels
    const allChannels = [
      ...config.agents.flatMap((a) => a.channels),
      ...config.sharedChannels.map((s) => s.name),
    ];
    return new Set(allChannels).size === allChannels.length;
  },
  { message: 'Channel names must be unique across all agents and shared channels' },
).refine(
  (config) => {
    // Check shared channel agent references exist
    const agentNames = new Set(config.agents.map((a) => a.name));
    return config.sharedChannels.every((sc) =>
      sc.agentAccess.every((name) => agentNames.has(name)),
    );
  },
  { message: 'sharedChannels reference agent names that do not exist in agents[]' },
).refine(
  (config) => {
    // Check envPrefix values are unique
    const prefixes = config.agents.map((a) => a.envPrefix);
    return new Set(prefixes).size === prefixes.length;
  },
  { message: 'envPrefix must be unique across all agents' },
);

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentSchema>;
