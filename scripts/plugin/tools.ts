// 8 Agent Tools for the OpenClaw plugin
// Each wraps existing command logic with dynamic imports to avoid loading viem at registration

import type { PluginTool } from './types.js';
import type { PaymentWatcher } from './watcher.js';

export function createTools(watcher: PaymentWatcher | null): PluginTool[] {
  return [
    // 1. x402_balance
    {
      name: 'x402_balance',
      description: 'Check wallet USDC and ETH balances on Base',
      inputSchema: { type: 'object', properties: {}, required: [] },
      async execute() {
        const { getClient, getWalletAddress, getUsdcBalance, getEthBalance } = await import('../core/client.js');
        const client = getClient();
        const address = getWalletAddress();
        const [usdc, eth] = await Promise.all([getUsdcBalance(), getEthBalance()]);

        return {
          address,
          network: client.config.network,
          chainId: client.config.chainId,
          balances: {
            usdc: { raw: usdc.raw.toString(), formatted: usdc.formatted },
            eth: { raw: eth.raw.toString(), formatted: eth.formatted },
          },
        };
      },
    },

    // 2. x402_pay
    {
      name: 'x402_pay',
      description: 'Pay for an x402-gated resource. Returns the response body after payment.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the x402-gated resource' },
          method: { type: 'string', description: 'HTTP method (default: GET)' },
          body: { type: 'string', description: 'Request body for POST/PUT' },
          maxPaymentUsd: { type: 'number', description: 'Maximum payment in USD' },
          dryRun: { type: 'boolean', description: 'If true, show payment details without paying' },
        },
        required: ['url'],
      },
      async execute(params) {
        const url = params.url as string;
        const method = (params.method as string) || 'GET';
        const body = params.body as string | undefined;
        const maxPaymentUsd = params.maxPaymentUsd as number | undefined;
        const dryRun = params.dryRun as boolean | undefined;

        const { getClient } = await import('../core/client.js');
        const client = getClient();

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (body) headers['Content-Type'] = 'application/json';

        // Probe for 402
        const probe = await fetch(url, { method, body, headers });

        if (probe.status !== 402) {
          const contentType = probe.headers.get('content-type');
          const responseBody = contentType?.includes('json')
            ? await probe.json()
            : await probe.text();
          return { paid: false, status: probe.status, response: responseBody };
        }

        // Parse payment info
        let paymentInfo: Record<string, unknown> | null = null;
        const xPayment = probe.headers.get('x-payment');
        if (xPayment) {
          try { paymentInfo = JSON.parse(Buffer.from(xPayment, 'base64').toString()); } catch { /* */ }
        }
        if (!paymentInfo) {
          try { paymentInfo = await probe.json() as Record<string, unknown>; } catch { /* */ }
        }

        const accepts = (paymentInfo as Record<string, unknown>)?.accepts as Array<Record<string, unknown>> | undefined;
        const priceStr = String(accepts?.[0]?.price ?? accepts?.[0]?.maxAmountRequired ?? '0');
        const priceNum = parseFloat(priceStr.replace(/[$,]/g, ''));
        const effectiveMax = maxPaymentUsd ?? client.config.maxPaymentUsd;

        if (priceNum > effectiveMax) {
          return { paid: false, error: `Price $${priceNum} exceeds max $${effectiveMax}`, paymentInfo };
        }

        if (dryRun) {
          return { paid: false, dryRun: true, price: priceNum, paymentInfo };
        }

        // Execute payment
        const response = await client.fetchWithPayment(url, { method, body, headers });

        if (!response.ok) {
          return { paid: false, error: `${response.status} ${response.statusText}` };
        }

        const contentType = response.headers.get('content-type');
        const responseBody = contentType?.includes('json')
          ? await response.json()
          : await response.text();

        let txHash: string | undefined;
        const paymentResponse = response.headers.get('x-payment-response');
        if (paymentResponse) {
          try {
            const receipt = JSON.parse(Buffer.from(paymentResponse, 'base64').toString());
            txHash = receipt.transactionHash ?? receipt.txHash;
          } catch { /* */ }
        }

        return { paid: true, price: priceNum, transactionHash: txHash, response: responseBody };
      },
    },

    // 3. x402_fetch
    {
      name: 'x402_fetch',
      description: 'Fetch a URL with automatic x402 payment handling. Simpler than x402_pay — just returns the content.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          method: { type: 'string', description: 'HTTP method (default: GET)' },
          body: { type: 'string', description: 'Request body for POST/PUT' },
        },
        required: ['url'],
      },
      async execute(params) {
        const url = params.url as string;
        const method = (params.method as string) || 'GET';
        const body = params.body as string | undefined;

        const { getClient } = await import('../core/client.js');
        const client = getClient();

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (body) headers['Content-Type'] = 'application/json';

        const response = await client.fetchWithPayment(url, { method, body, headers });

        if (!response.ok) {
          return { success: false, status: response.status, error: response.statusText };
        }

        const contentType = response.headers.get('content-type');
        const responseBody = contentType?.includes('json')
          ? await response.json()
          : await response.text();

        return { success: true, status: response.status, response: responseBody };
      },
    },

    // 4. x402_create_link
    {
      name: 'x402_create_link',
      description: 'Create a payment link via 21.cash to sell gated content',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the payment link' },
          price: { type: 'string', description: 'Price in USD (e.g., "5.00")' },
          url: { type: 'string', description: 'URL to gate behind payment' },
          text: { type: 'string', description: 'Text content to gate behind payment' },
          description: { type: 'string', description: 'Description of the link' },
          webhookUrl: { type: 'string', description: 'Webhook URL for payment notifications' },
        },
        required: ['name', 'price'],
      },
      async execute(params) {
        const name = params.name as string;
        const price = params.price as string;
        const gatedUrl = params.url as string | undefined;
        const gatedText = params.text as string | undefined;
        const description = params.description as string | undefined;
        const webhookUrl = params.webhookUrl as string | undefined;

        if (!gatedUrl && !gatedText) {
          return { success: false, error: 'Either url or text is required' };
        }

        const { getClient, getWalletAddress } = await import('../core/client.js');
        const { getConfig } = await import('../core/config.js');

        const config = getConfig();
        const client = getClient();
        const creatorAddress = getWalletAddress();

        const requestBody: Record<string, unknown> = {
          name,
          price,
          creatorAddress,
          chainId: config.chainId,
        };
        if (description) requestBody.description = description;
        if (gatedUrl) requestBody.gatedUrl = gatedUrl;
        if (gatedText) requestBody.gatedText = gatedText;
        if (webhookUrl) requestBody.webhookUrl = webhookUrl;

        const apiUrl = `${config.x402LinksApiUrl}/api/links/programmatic`;
        const response = await client.fetchWithPayment(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        const data = await response.json();
        if (!response.ok || !(data as Record<string, unknown>).success) {
          return { success: false, error: (data as Record<string, unknown>).error ?? 'Unknown error' };
        }

        return data;
      },
    },

    // 5. x402_link_info
    {
      name: 'x402_link_info',
      description: 'Get details about a payment link by router address',
      inputSchema: {
        type: 'object',
        properties: {
          routerAddress: { type: 'string', description: 'Router contract address or payment URL' },
        },
        required: ['routerAddress'],
      },
      async execute(params) {
        let routerAddress = params.routerAddress as string;

        // Extract address from URL if needed
        if (routerAddress.startsWith('http')) {
          const url = new URL(routerAddress);
          const parts = url.pathname.split('/');
          routerAddress = parts[parts.length - 1];
        }

        if (!routerAddress.startsWith('0x') || routerAddress.length !== 42) {
          return { success: false, error: 'Invalid router address' };
        }

        const { getConfig } = await import('../core/config.js');
        const config = getConfig();

        const apiUrl = `${config.x402LinksApiUrl}/api/links/${routerAddress}/details`;
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!response.ok || !(data as Record<string, unknown>).success) {
          return { success: false, error: (data as Record<string, unknown>).error ?? 'Link not found' };
        }

        return data;
      },
    },

    // 6. x402_routers
    {
      name: 'x402_routers',
      description: 'List payment routers where your wallet is a beneficiary',
      inputSchema: {
        type: 'object',
        properties: {
          withBalances: { type: 'boolean', description: 'Fetch on-chain USDC balance for each router' },
        },
      },
      async execute(params) {
        const withBalances = params.withBalances as boolean | undefined;

        const { getWalletAddress } = await import('../core/client.js');
        const { getConfig, getUsdcAddress } = await import('../core/config.js');

        const config = getConfig();
        const address = getWalletAddress();

        const apiUrl = `${config.x402LinksApiUrl}/api/links/beneficiary/${address}`;
        const response = await fetch(apiUrl);
        const data = await response.json() as { success: boolean; links?: Array<Record<string, unknown>>; error?: string };

        if (!response.ok || !data.success) {
          return { success: false, error: data.error ?? 'Failed to fetch routers' };
        }

        const links = data.links ?? [];

        if (!withBalances) {
          return {
            success: true,
            address,
            routers: links.map((l) => ({
              routerAddress: l.router_address,
              name: (l.metadata as Record<string, unknown>)?.name ?? 'Unnamed',
              chainId: l.chain_id,
              sharePercent: l.beneficiary_percentage,
              createdAt: l.created_at,
            })),
          };
        }

        // Fetch balances
        const { getClient } = await import('../core/client.js');
        const { formatUnits } = await import('viem');
        const client = getClient();
        const usdcAddress = getUsdcAddress(config.chainId);

        const ERC20_ABI = [{
          name: 'balanceOf' as const,
          type: 'function' as const,
          stateMutability: 'view' as const,
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        }] as const;

        const routers = await Promise.all(links.map(async (l) => {
          const routerAddr = l.router_address as `0x${string}`;
          const share = (l.beneficiary_percentage as number) / 100;
          let balance = '0';
          try {
            const bal = await client.publicClient.readContract({
              address: usdcAddress,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [routerAddr],
            });
            balance = formatUnits(bal, 6);
          } catch { /* */ }

          return {
            routerAddress: l.router_address,
            name: (l.metadata as Record<string, unknown>)?.name ?? 'Unnamed',
            chainId: l.chain_id,
            sharePercent: l.beneficiary_percentage,
            balance,
            estimatedWithdrawal: (parseFloat(balance) * share).toFixed(6),
            createdAt: l.created_at,
          };
        }));

        return { success: true, address, routers };
      },
    },

    // 7. x402_distribute
    {
      name: 'x402_distribute',
      description: 'Distribute (withdraw) USDC from a PaymentRouter contract',
      inputSchema: {
        type: 'object',
        properties: {
          routerAddress: { type: 'string', description: 'PaymentRouter contract address' },
          amount: { type: 'string', description: 'USDC amount to distribute (defaults to full balance)' },
        },
        required: ['routerAddress'],
      },
      async execute(params) {
        const routerAddress = params.routerAddress as string;
        const specifiedAmount = params.amount as string | undefined;

        if (!routerAddress.startsWith('0x') || routerAddress.length !== 42) {
          return { success: false, error: 'Invalid router address' };
        }

        const { getClient } = await import('../core/client.js');
        const { getConfig, getUsdcAddress } = await import('../core/config.js');
        const { formatUnits, parseUnits } = await import('viem');

        const config = getConfig();
        const client = getClient();
        const usdcAddress = getUsdcAddress(config.chainId);
        const routerAddr = routerAddress as `0x${string}`;

        const ERC20_ABI = [{
          name: 'balanceOf' as const,
          type: 'function' as const,
          stateMutability: 'view' as const,
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        }] as const;

        const ROUTER_ABI = [{
          name: 'distribute' as const,
          type: 'function' as const,
          stateMutability: 'nonpayable' as const,
          inputs: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [],
        }] as const;

        const routerBalance = await client.publicClient.readContract({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [routerAddr],
        });

        if (routerBalance === 0n) {
          return { success: false, error: 'Router has no USDC balance to distribute' };
        }

        let distributeAmount: bigint;
        if (specifiedAmount) {
          distributeAmount = parseUnits(specifiedAmount, 6);
          if (distributeAmount > routerBalance) {
            return {
              success: false,
              error: `Requested ${specifiedAmount} USDC exceeds balance ${formatUnits(routerBalance, 6)} USDC`,
            };
          }
        } else {
          distributeAmount = routerBalance;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const txHash = await (client.walletClient as any).writeContract({
          address: routerAddr,
          abi: ROUTER_ABI,
          functionName: 'distribute',
          args: [usdcAddress, distributeAmount],
        });

        const receipt = await client.publicClient.waitForTransactionReceipt({ hash: txHash });

        return {
          success: receipt.status === 'success',
          routerAddress,
          amount: formatUnits(distributeAmount, 6),
          amountRaw: distributeAmount.toString(),
          transactionHash: txHash,
          blockNumber: receipt.blockNumber.toString(),
          status: receipt.status,
        };
      },
    },

    // 8. x402_watcher_status
    {
      name: 'x402_watcher_status',
      description: 'Get the status of the background payment watcher (tracked routers, payments detected)',
      inputSchema: { type: 'object', properties: {}, required: [] },
      async execute() {
        if (!watcher) {
          return { running: false, error: 'Watcher is not enabled' };
        }
        return watcher.getStatus();
      },
    },
  ];
}
