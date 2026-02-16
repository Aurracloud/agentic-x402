// Maps OpenClaw plugin config → process.env vars
// Only sets vars that are not already defined (env vars take priority)

import type { X402PluginConfig } from './types.js';

const CONFIG_MAP: Record<keyof Omit<X402PluginConfig, 'watcher'>, string> = {
  evmPrivateKey: 'EVM_PRIVATE_KEY',
  network: 'X402_NETWORK',
  maxPaymentUsd: 'X402_MAX_PAYMENT_USD',
  x402LinksApiUrl: 'X402_LINKS_API_URL',
};

/**
 * Inject plugin config values into process.env if not already set.
 *
 * Priority chain:
 * 1. Real env vars (highest — already in process.env)
 * 2. Plugin config (injected here)
 * 3. ~/.x402/.env (loaded by core/config.ts with override: false)
 * 4. Hardcoded defaults in core/config.ts
 */
export function applyConfigBridge(pluginConfig: Record<string, unknown>): void {
  const config = pluginConfig as X402PluginConfig;

  for (const [key, envVar] of Object.entries(CONFIG_MAP)) {
    const value = config[key as keyof Omit<X402PluginConfig, 'watcher'>];
    if (value !== undefined && value !== null && !process.env[envVar]) {
      process.env[envVar] = String(value);
    }
  }
}
