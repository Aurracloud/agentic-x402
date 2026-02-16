// CLI commands for the OpenClaw plugin
// Registered via api.registerCli with Commander.js-style program

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
        if (watcher) {
          console.log('Watcher is already running as a background service.');
          const status = watcher.getStatus();
          console.log(`Tracking ${status.trackedRouters.length} router(s)`);
          console.log(`Payments detected: ${status.paymentsDetected}`);
          return;
        }

        // Start a standalone watcher for debugging
        const { PaymentWatcher: WatcherClass } = await import('./watcher.js');
        const { applyConfigBridge } = await import('./config-bridge.js');

        applyConfigBridge({});

        const interval = parseInt(intervalStr, 10);

        const debugWatcher = new WatcherClass({
          logger,
          gatewayPort: 0,
          pollIntervalMs: interval,
          notifyOnPayment: false,
        });

        console.log('Starting payment watcher in foreground...');
        console.log('Press Ctrl+C to stop.\n');

        process.on('SIGINT', async () => {
          await debugWatcher.stop();
          process.exit(0);
        });

        await debugWatcher.start();

        // Keep alive
        await new Promise(() => {});
      });

    x402
      .command('status')
      .description('Show payment watcher status, tracked routers, and payment count')
      .action(() => {
        if (!watcher) {
          console.log('Payment watcher is not running.');
          console.log('Enable it in your OpenClaw plugin config or start it with: openclaw x402 watch');
          return;
        }

        const status = watcher.getStatus();

        console.log('x402 Payment Watcher Status');
        console.log('===========================\n');
        console.log(`Running:           ${status.running ? 'Yes' : 'No'}`);
        console.log(`Poll interval:     ${status.pollIntervalMs / 1000}s`);
        console.log(`Payments detected: ${status.paymentsDetected}`);
        console.log(`Last poll:         ${status.lastPollAt ?? 'Never'}`);

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
      });
  }, { commands: ['x402'] });
}
