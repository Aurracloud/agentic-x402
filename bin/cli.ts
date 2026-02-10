#!/usr/bin/env npx tsx
// x402 CLI - Agent skill for x402 payments

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptsDir = resolve(__dirname, '../scripts');

interface Command {
  script: string;
  description: string;
  category: 'info' | 'payments' | 'links';
}

const commands: Record<string, Command> = {
  // Info commands
  balance: {
    script: 'commands/balance.ts',
    description: 'Check wallet USDC and ETH balances',
    category: 'info',
  },

  // Payment commands
  pay: {
    script: 'commands/pay.ts',
    description: 'Pay for an x402-gated resource',
    category: 'payments',
  },
  fetch: {
    script: 'commands/fetch-paid.ts',
    description: 'Fetch URL with automatic x402 payment',
    category: 'payments',
  },

  // Link commands (21cash integration)
  'create-link': {
    script: 'commands/create-link.ts',
    description: 'Create a payment link to sell content',
    category: 'links',
  },
  'link-info': {
    script: 'commands/link-info.ts',
    description: 'Get info about a payment link',
    category: 'links',
  },
};

function showHelp() {
  console.log(`
x402 - Agent skill for x402 payments

Usage: x402 <command> [arguments]

Info Commands:
  balance             Check wallet USDC and ETH balances

Payment Commands:
  pay <url>           Pay for an x402-gated resource
  fetch <url>         Fetch URL with automatic x402 payment

Link Commands (21cash integration):
  create-link         Create a payment link to sell content
  link-info <addr>    Get info about a payment link

Options:
  -h, --help          Show this help
  -v, --version       Show version

Environment Variables:
  EVM_PRIVATE_KEY       Wallet private key (required)
  X402_NETWORK          Network: mainnet or testnet (default: mainnet)
  X402_MAX_PAYMENT_USD  Max payment limit in USD (default: 10)
  X402_FACILITATOR_URL  Custom facilitator URL
  X402_LINKS_API_URL    x402-links-server URL (for link commands)
  X402_LINKS_API_KEY    API key for x402-links-server

Examples:
  x402 balance
  x402 pay https://api.example.com/data
  x402 fetch https://api.example.com/resource --json
  x402 create-link --name "Guide" --price 5.00 --url https://mysite.com/guide

For command-specific help: x402 <command> --help
`);
}

function showVersion() {
  console.log('agentic-x402 v0.1.0');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    showHelp();
    process.exit(0);
  }

  if (args[0] === '-v' || args[0] === '--version' || args[0] === 'version') {
    showVersion();
    process.exit(0);
  }

  const commandName = args[0];
  const command = commands[commandName];

  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    console.error('Run "x402 --help" for available commands.');
    process.exit(1);
  }

  const scriptPath = resolve(scriptsDir, command.script);
  const commandArgs = args.slice(1);

  // Run the script with tsx
  const child = spawn('npx', ['tsx', scriptPath, ...commandArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      X402_CWD: process.cwd(),
    },
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error('Failed to run command:', err.message);
    process.exit(1);
  });
}

main();
