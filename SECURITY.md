# Security policy

## Supported versions

The 0.1.x series is a preview. Security reports for this series are welcome.

## Reporting a vulnerability

Use GitHub private vulnerability reporting on this repository's Security tab. Include reproduction steps, affected version, impact, and any relevant logs with secrets removed. Please avoid public disclosure until maintainers have had an opportunity to investigate and coordinate a fix.

## Threat model

MCP servers may be hostile or compromised. In scope are weaknesses in handling untrusted server responses, leakage of secrets in reports or output, leaked child processes, and terminal or Markdown injection. The probe is intended to inspect using read-only protocol operations; any weakening of that guarantee is in scope.

Out of scope are vulnerabilities in an MCP server itself that do not arise from the probe, compromise of the host or user's credentials outside the probe, and availability or behavior of third-party services. Reports that cross these boundaries are welcome when they demonstrate a specific vulnerability in this project.
