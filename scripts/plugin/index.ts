// OpenClaw Plugin Entry Point for agentic-x402

import type { OpenClawPluginApi, X402PluginConfig } from './types.js';
import { applyConfigBridge } from './config-bridge.js';
import { PaymentWatcher } from './watcher.js';
import { createTools } from './tools.js';
import { registerCliCommands } from './cli.js';

export default {
  id: 'agentic-x402',
  name: 'x402 Payments',

  register(api: OpenClawPluginApi): void {
    const { logger, config, gatewayPort } = api;
    const pluginConfig = config as X402PluginConfig;

    // 1. Apply config bridge: inject plugin config → process.env
    applyConfigBridge(config);
    logger.debug('x402 config bridge applied');

    // 2. Register background watcher service (unless disabled)
    let watcher: PaymentWatcher | null = null;
    const watcherEnabled = pluginConfig.watcher?.enabled !== false;

    if (watcherEnabled) {
      watcher = new PaymentWatcher({
        logger,
        gatewayPort,
        hooksToken: pluginConfig.hooksToken,
        pollIntervalMs: pluginConfig.watcher?.pollIntervalMs,
        notifyOnPayment: pluginConfig.watcher?.notifyOnPayment,
      });
      api.registerService(watcher);
      logger.debug('x402 payment watcher registered');
    } else {
      logger.debug('x402 payment watcher disabled by config');
    }

    // 3. Register agent tools
    const tools = createTools(watcher);
    for (const tool of tools) {
      api.registerTool(tool);
    }
    logger.debug(`Registered ${tools.length} x402 agent tools`);

    // 4. Register CLI commands
    registerCliCommands(api, watcher, logger);
    logger.debug('x402 CLI commands registered');
  },
};
