// OpenClaw Plugin API types for agentic-x402

/** Logger provided by OpenClaw to plugins */
export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/** A background service registered by a plugin */
export interface PluginService {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** JSON Schema for tool parameters */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

/** Tool result content block */
export interface ToolResultContent {
  type: 'text';
  text: string;
}

/** An agent tool registered by a plugin */
export interface PluginTool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute(toolCallId: string, params: Record<string, unknown>): Promise<{
    content: ToolResultContent[];
    details?: unknown;
  }>;
}

/** Commander.js-style program for CLI registration */
export interface CliProgram {
  command(name: string): CliCommand;
}

export interface CliCommand {
  command(name: string): CliCommand;
  description(desc: string): CliCommand;
  argument(name: string, desc?: string): CliCommand;
  option(flags: string, desc?: string, defaultValue?: unknown): CliCommand;
  action(fn: (...args: unknown[]) => void | Promise<void>): CliCommand;
}

/** The API that OpenClaw passes to plugin register() */
export interface OpenClawPluginApi {
  logger: PluginLogger;
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  gatewayPort: number;
  registerService(service: PluginService): void;
  registerTool(tool: PluginTool): void;
  registerCli(
    setup: (ctx: { program: CliProgram }) => void,
    opts: { commands: string[] },
  ): void;
}

/** Plugin config schema matching openclaw.plugin.json */
export interface X402PluginConfig {
  evmPrivateKey?: string;
  network?: 'mainnet' | 'testnet';
  maxPaymentUsd?: number;
  x402LinksApiUrl?: string;
  hooksToken?: string;
  watcher?: {
    enabled?: boolean;
    pollIntervalMs?: number;
    notifyOnPayment?: boolean;
  };
}

/** Tracked router state in the watcher */
export interface TrackedRouter {
  address: string;
  name: string;
  lastBalance: bigint;
  lastChecked: number;
}

/** Payment detection event */
export interface PaymentEvent {
  routerAddress: string;
  routerName: string;
  previousBalance: string;
  newBalance: string;
  increase: string;
  detectedAt: string;
}

/** Watcher status for introspection */
export interface WatcherStatus {
  running: boolean;
  pollIntervalMs: number;
  trackedRouters: Array<{
    address: string;
    name: string;
    balance: string;
    lastChecked: string;
  }>;
  paymentsDetected: number;
  lastPollAt: string | null;
}
