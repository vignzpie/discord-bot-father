import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { ConfigSchema } from './config.schema.js';
import { validateAllTokens } from './validate.js';
import { setupGuildChannels } from './channels.js';
import { generateInviteUrls } from './invites.js';
import { writeOutputFiles, sanitizeConfigFile } from './output.js';
import { log } from './logger.js';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const clean = args.includes('--clean');
  const configArg = args.find((a) => !a.startsWith('--')) ?? 'config.json';
  const configPath = resolve(configArg);

  log.step('discord-bot-father');
  log.dim(`Config: ${configPath}`);
  if (dryRun) log.warn('Dry run mode — no Discord channels will be created');
  if (clean) log.warn('Clean mode — existing channels will be archived and recreated');

  // Phase 1: Load & validate config
  log.step('Phase 1: Loading config');

  if (!existsSync(configPath)) {
    log.error(`Config file not found: ${configPath}`);
    log.info('Copy config.example.json to config.json and fill in your bot tokens.');
    process.exit(1);
  }

  let config;
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    config = ConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      log.error('Config validation failed:');
      for (const issue of err.issues) {
        log.error(`  ${issue.path.join('.')}: ${issue.message}`);
      }
    } else {
      log.error(`Failed to parse config: ${err}`);
    }
    process.exit(1);
  }

  log.success(`${config.agents.length} agents, ${config.guilds.length} guild(s), ${config.sharedChannels.length} shared channel(s)`);

  // Preview: show what the Discord server will look like
  console.log('');
  console.log(`Channel preview:`);
  console.log(`  📁 ${config.categoryName}`);
  for (const agent of config.agents) {
    for (const ch of agent.channels) {
      console.log(`     #${ch}  ← ${agent.name} only`);
    }
  }
  for (const shared of config.sharedChannels) {
    const access = shared.agentAccess.join(', ');
    console.log(`     #${shared.name}  ← shared: ${access}`);
  }
  console.log('');

  // Phase 2: Validate tokens
  log.step('Phase 2: Validating bot tokens');
  const botMeta = await validateAllTokens(config.agents, config.guilds);
  log.success('All tokens valid');

  // Phase 3: Setup channels
  let channelMap = new Map<string, Map<string, string>>();
  if (!dryRun) {
    log.step('Phase 3: Setting up channels');
    channelMap = await setupGuildChannels(config, botMeta, clean);
    log.success('All channels configured');
  } else {
    log.step('Phase 3: Skipped (dry run)');
  }

  // Phase 4: Generate outputs
  log.step('Phase 4: Generating output files');
  const inviteUrls = generateInviteUrls(config.agents, botMeta);
  writeOutputFiles(config, botMeta, channelMap, inviteUrls);

  // Phase 5: Summary
  log.step('Setup complete');
  console.log('');
  console.log('Invite URLs (add bots to your server):');
  for (const agent of config.agents) {
    const meta = botMeta.get(agent.name)!;
    console.log(`  ${agent.name} (${meta.username})`);
    console.log(`    ${inviteUrls.get(agent.name)}`);
    console.log('');
  }

  if (channelMap.size > 0) {
    console.log('Channels created:');
    for (const [guildId, channels] of channelMap) {
      console.log(`  Guild ${guildId}:`);
      for (const [name, id] of channels) {
        console.log(`    #${name} => ${id}`);
      }
    }
    console.log('');
  }

  console.log(`Output files:`);
  console.log(`  ${config.output.envFile}`);
  if (config.output.perAgentEnvFiles) {
    for (const agent of config.agents) {
      console.log(`  ${config.output.envFile.replace('.env', `.${agent.name}.env`)}`);
    }
  }
  console.log(`  ${config.output.summaryFile}`);

  // Sanitize config file — replace tokens with placeholders
  sanitizeConfigFile(configPath);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
