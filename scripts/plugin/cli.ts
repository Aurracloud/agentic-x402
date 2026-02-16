// CLI commands for the OpenClaw plugin
// Registered via api.registerCli with Commander.js-style program

import { getWalletAddress } from '../core/client.js';
import type { PluginLogger, OpenClawPluginApi } from './types.js';
import type { PaymentWatcher } from './watcher.js';

export function registerCliCommands(
  api: OpenClawPluginApi,
  watcher: PaymentWatcher | null,
  logger: PluginLogger,
): void {
  api.registerCli(({ program }) => {
    const x402 = program.command('x402').description('x402 payment tools');

    x402
      .command('watch')
      .description('Start the payment watcher in foreground (for debugging)')
      .option('--interval <ms>', 'Poll interval in milliseconds', '30000')
      .action(async (opts: unknown) => {
        const { interval: intervalStr } = opts as { interval: string };

        // If the watcher is actually running (gateway context), show its status
        if (watcher && watcher.getStatus().running) {
          const status = watcher.getStatus();
          console.log('Watcher is running as a background service.');
          console.log(`Tracking ${status.trackedRouters.length} router(s)`);
          console.log(`Payments detected: ${status.paymentsDetected}`);
          console.log(`Last poll: ${status.lastPollAt ?? 'Never'}`);
          return;
        }

        // CLI context: watcher exists but was never start()-ed, or is null.
        // Start a watcher in foreground for debugging.
        const { PaymentWatcher: WatcherClass } = await import('./watcher.js');

        const interval = parseInt(intervalStr, 10);
        const address = getWalletAddress();

        const fgWatcher = new WatcherClass({
          logger,
          gatewayPort: api.gatewayPort || 0,
          pollIntervalMs: interval,
          notifyOnPayment: api.gatewayPort > 0,
        });

        console.log(`Starting payment watcher in foreground for ${address}...`);
        console.log(`Poll interval: ${interval / 1000}s`);
        console.log('Press Ctrl+C to stop.\n');

        process.on('SIGINT', async () => {
          await fgWatcher.stop();
          process.exit(0);
        });

        await fgWatcher.start();

        // Keep alive
        await new Promise(() => {});
      });

    x402
      .command('status')
      .description('Show payment watcher status, tracked routers, and payment count')
      .action(async () => {
        const address = getWalletAddress();

        // If watcher is running in gateway context, show its live state
        if (watcher && watcher.getStatus().running) {
          const status = watcher.getStatus();

          console.log('x402 Payment Watcher Status');
          console.log('===========================\n');
          console.log(`Running:           Yes (background service)`);
          console.log(`Poll interval:     ${status.pollIntervalMs / 1000}s`);
          console.log(`Payments detected: ${status.paymentsDetected}`);
          console.log(`Last poll:         ${status.lastPollAt ?? 'Never'}`);
          console.log(`Wallet address:    ${address}`);

          if (status.trackedRouters.length === 0) {
            console.log('\nNo routers tracked yet.');
          } else {
            console.log(`\nTracked Routers (${status.trackedRouters.length}):`);
            for (const r of status.trackedRouters) {
              console.log(`  ${r.name}`);
              console.log(`    Address: ${r.address}`);
              console.log(`    Balance: ${r.balance} USDC`);
              console.log(`    Checked: ${r.lastChecked}`);
              console.log('');
            }
          }
          return;
        }

        // CLI context: do a one-shot poll to show current state
        console.log('x402 Watcher Status (live query)');
        console.log('================================\n');
        console.log(`Wallet: ${address}`);

        const { getConfig, getUsdcAddress } = await import('../core/config.js');
        const { getClient } = await import('../core/client.js');
        const { formatUnits } = await import('viem');

        const config = getConfig();

        // Fetch routers from API
        const apiUrl = `${config.x402LinksApiUrl}/api/links/beneficiary/${address}`;
        const response = await fetch(apiUrl);
        const data = await response.json() as {
          success: boolean;
          links?: Array<{
            router_address: string;
            metadata?: { name?: string };
          }>;
        };

        if (!data.success || !data.links || data.links.length === 0) {
          console.log('No routers found for this wallet.');
          return;
        }

        console.log(`Found ${data.links.length} router(s):\n`);

        const client = getClient();
        const usdcAddress = getUsdcAddress(config.chainId);

        const ERC20_ABI = [{
          name: 'balanceOf' as const,
          type: 'function' as const,
          stateMutability: 'view' as const,
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        }] as const;

        for (const link of data.links) {
          const name = link.metadata?.name ?? 'Unnamed';
          let balance = '?';
          try {
            const bal = await client.publicClient.readContract({
              address: usdcAddress,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [link.router_address as `0x${string}`],
            });
            balance = `${formatUnits(bal, 6)} USDC`;
          } catch { /* */ }

          console.log(`  ${name}`);
          console.log(`    Router:  ${link.router_address}`);
          console.log(`    Balance: ${balance}`);
          console.log('');
        }

        if (watcher && !watcher.getStatus().running) {
          console.log('Note: The background watcher is registered but not running.');
          console.log('It starts automatically with the gateway. Use "openclaw x402 watch" for foreground mode.');
        }
      });
  }, { commands: ['x402'] });
}
