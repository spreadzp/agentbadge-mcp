# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.3.x   | Yes       |

## Reporting a Vulnerability

Please do NOT report security vulnerabilities through public GitHub issues.

Instead, report them via GitHub's private vulnerability reporting:
https://github.com/spreadzp/agentbadge-mcp/security/advisories/new

Alternatively, open a confidential report through the contact channels listed at https://agentbadge.xyz/security.txt

We aim to acknowledge reports within 72 hours and provide a status update within 7 days. If the issue is confirmed, we will work on a fix and coordinate disclosure with the reporter.

## Scope

- The `@agentbadge/mcp` MCP server package (this repository)
- The remote endpoint `https://agentbadge.xyz/mcp`

## Notes

- Never commit secrets, private keys, or `.env` files to this repository.
- Payment flows use x402 on Arc; report any payment-signature verification bypass as high severity.
