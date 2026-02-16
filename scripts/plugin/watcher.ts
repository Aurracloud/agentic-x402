// Background Payment Watcher
// Polls USDC balanceOf for tracked routers and detects balance increases

import type {
  PluginLogger,
  PluginService,
  TrackedRouter,
  PaymentEvent,
  WatcherStatus,
} from './types.js';

const ERC20_BALANCE_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

interface WatcherOptions {
  logger: PluginLogger;
  gatewayPort: number;
  pollIntervalMs?: number;
  notifyOnPayment?: boolean;
}

export class PaymentWatcher implements PluginService {
  readonly id = 'x402-payment-watcher';

  private logger: PluginLogger;
  private gatewayPort: number;
  private pollIntervalMs: number;
  private notifyOnPayment: boolean;

  private trackedRouters: Map<string, TrackedRouter> = new Map();
  private paymentsDetected = 0;
  private lastPollAt: Date | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private seeded = false;

  constructor(options: WatcherOptions) {
    this.logger = options.logger;
    this.gatewayPort = options.gatewayPort;
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.notifyOnPayment = options.notifyOnPayment ?? true;
  }

  async start(): Promise<void> {
    this.logger.info(`Starting payment watcher (poll every ${this.pollIntervalMs / 1000}s)`);

    // Set timer first so the watcher is "running" even if initial poll fails
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);

    // Initial poll to seed state (errors are caught inside poll())
    await this.poll();
    this.seeded = true;
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info('Payment watcher stopped');
  }

  getStatus(): WatcherStatus {
    const routers: WatcherStatus['trackedRouters'] = [];
    for (const r of this.trackedRouters.values()) {
      routers.push({
        address: r.address,
        name: r.name,
        balance: formatUnitsLocal(r.lastBalance, 6),
        lastChecked: r.lastChecked ? new Date(r.lastChecked).toISOString() : 'never',
      });
    }

    return {
      running: this.timer !== null,
      pollIntervalMs: this.pollIntervalMs,
      trackedRouters: routers,
      paymentsDetected: this.paymentsDetected,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
    };
  }

  private async poll(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      await this.refreshRouters();
      await this.checkBalances();
      this.lastPollAt = new Date();
    } catch (err) {
      this.logger.error(`Watcher poll error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.isPolling = false;
    }
  }

  private async refreshRouters(): Promise<void> {
    // Dynamic import to avoid loading viem at registration time
    const { getWalletAddress } = await import('../core/client.js');
    const { getConfig } = await import('../core/config.js');

    const config = getConfig();
    const address = getWalletAddress();
    const apiUrl = `${config.x402LinksApiUrl}/api/links/beneficiary/${address}`;

    this.logger.debug(`Fetching routers for ${address} from ${apiUrl}`);

    const response = await fetch(apiUrl);
    if (!response.ok) {
      this.logger.warn(`Failed to fetch routers: ${response.status}`);
      return;
    }

    const data = await response.json() as {
      success: boolean;
      links?: Array<{
        router_address: string;
        metadata?: { name?: string };
      }>;
    };

    if (!data.success || !data.links) {
      this.logger.debug(`Router API returned success=${data.success}, links=${data.links?.length ?? 0}`);
      return;
    }

    // Add any new routers we haven't seen yet
    for (const link of data.links) {
      const addr = link.router_address.toLowerCase();
      if (!this.trackedRouters.has(addr)) {
        this.trackedRouters.set(addr, {
          address: link.router_address,
          name: link.metadata?.name ?? 'Unnamed',
          lastBalance: 0n,
          lastChecked: 0,
        });
        this.logger.info(`Tracking router: ${link.metadata?.name ?? 'Unnamed'} (${link.router_address})`);
      }
    }

    this.logger.debug(`Tracking ${this.trackedRouters.size} router(s)`);
  }

  private async checkBalances(): Promise<void> {
    if (this.trackedRouters.size === 0) return;

    const { getClient } = await import('../core/client.js');
    const { getConfig, getUsdcAddress } = await import('../core/config.js');

    const config = getConfig();
    const client = getClient();
    const usdcAddress = getUsdcAddress(config.chainId);

    for (const [, router] of this.trackedRouters) {
      try {
        const balance = await client.publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [router.address as `0x${string}`],
        });

        const previous = router.lastBalance;
        router.lastBalance = balance;
        router.lastChecked = Date.now();

        // Skip notifications on first poll (seeding state)
        if (!this.seeded) continue;

        if (balance > previous) {
          const increase = balance - previous;
          this.paymentsDetected++;

          const event: PaymentEvent = {
            routerAddress: router.address,
            routerName: router.name,
            previousBalance: formatUnitsLocal(previous, 6),
            newBalance: formatUnitsLocal(balance, 6),
            increase: formatUnitsLocal(increase, 6),
            detectedAt: new Date().toISOString(),
          };

          this.logger.info(
            `Payment detected on ${router.name}: +${event.increase} USDC (${event.previousBalance} → ${event.newBalance})`
          );

          if (this.notifyOnPayment) {
            await this.sendHook(event);
          }
        } else if (balance < previous) {
          this.logger.debug(
            `Distribution from ${router.name}: ${formatUnitsLocal(previous, 6)} → ${formatUnitsLocal(balance, 6)} USDC`
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to check balance for ${router.name} (${router.address}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  private async sendHook(event: PaymentEvent): Promise<void> {
    const hookUrl = `http://127.0.0.1:${this.gatewayPort}/hooks/agent`;

    try {
      const response = await fetch(hookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'x402-payment',
          wakeMode: 'now',
          data: event,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Hook POST failed: ${response.status} ${response.statusText}`);
      } else {
        this.logger.debug(`Hook delivered for payment on ${event.routerName}`);
      }
    } catch (err) {
      this.logger.warn(`Hook POST error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Format bigint with decimals (avoids importing viem just for this) */
function formatUnitsLocal(value: bigint, decimals: number): string {
  const str = value.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, str.length - decimals) || '0';
  const fracPart = str.slice(str.length - decimals);
  // Trim trailing zeros but keep at least 2 decimal places
  const trimmed = fracPart.replace(/0+$/, '').padEnd(2, '0');
  return `${intPart}.${trimmed}`;
}
