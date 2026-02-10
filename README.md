# agentic-x402

Agent skill for x402 payments - pay for and sell gated content using USDC on Base.

## What is x402?

[x402](https://docs.x402.org/) is an open payment standard built around HTTP 402 Payment Required. It enables services to charge for API access directly over HTTP using crypto payments.

This skill gives AI agents the ability to:
- **Pay** for x402-gated resources automatically
- **Create** payment links to sell content
- **Manage** wallet balances

## Installation

```bash
# Clone or install
pnpm install

# Configure wallet
cp config/example.env .env
# Edit .env and add your EVM_PRIVATE_KEY
```

## Quick Start

```bash
# Check balance
x402 balance

# Pay for a resource
x402 pay https://api.example.com/paid-endpoint

# Fetch with auto-payment
x402 fetch https://api.example.com/data --json

# Create a payment link (requires x402-links-server)
x402 create-link --name "My API" --price 1.00 --url https://api.example.com/premium
```

## Commands

| Command | Description |
|---------|-------------|
| `x402 balance` | Check USDC and ETH balances |
| `x402 pay <url>` | Pay for a gated resource |
| `x402 fetch <url>` | Fetch with auto-payment |
| `x402 create-link` | Create payment link |
| `x402 link-info <addr>` | Get link details |

## Configuration

Required environment variables:
- `EVM_PRIVATE_KEY` - Your wallet private key

Optional:
- `X402_NETWORK` - `mainnet` or `testnet` (default: mainnet)
- `X402_MAX_PAYMENT_USD` - Payment limit (default: 10)
- `X402_LINKS_API_URL` - x402-links-server URL
- `X402_LINKS_API_KEY` - API key for link creation

## For Agents

This skill is designed for use with AI agents (Claude Code, OpenClaw, etc.). See `SKILL.md` for the full agent-readable documentation.

## License

MIT
