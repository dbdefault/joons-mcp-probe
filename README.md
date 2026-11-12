# JOONS MCP Probe

A lightweight MCP server inspection and validation toolkit for developers.

![Preview](https://img.shields.io/badge/status-Preview-orange) [![CI](https://github.com/dbdefault/joons-mcp-probe/actions/workflows/ci.yml/badge.svg)](https://github.com/dbdefault/joons-mcp-probe/actions/workflows/ci.yml) ![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)

Part of the [JOONS ecosystem](https://github.com/dbdefault/joons-ecosystem).

## What it checks

Connects over stdio or Streamable HTTP, negotiates the MCP protocol, inspects server information and capabilities, lists tools and validates tool names, descriptions and schemas. Reports include findings, timings and failures; paginated tool lists are bounded.

## What it never does

The probe is read-only: it does not call `tools/call`, `resources/read`, or `prompts/get`. It uses initialization, the initialized notification and `tools/list` (and may use `ping`). Starting a stdio server still runs the command you provide; only run servers you trust.

## Installation

Requires Node.js 20 or later. Install from source, or run without a global installation:

```sh
npm install -g github:dbdefault/joons-mcp-probe#v0.1.0
npx github:dbdefault/joons-mcp-probe#v0.1.0 --help
```

From a source checkout with dependencies installed, use `node bin/joons-mcp-probe.js` in place of `joons-mcp-probe`.

## Quick start

After a global install, probe your own server using its absolute path. For the bundled example, clone this repository and run `node bin/joons-mcp-probe.js stdio -- node examples/stdio-server.js` from the checkout root.

```sh
joons-mcp-probe stdio -- node /absolute/path/to/your-server.js
joons-mcp-probe http https://example.com/mcp
```

For authenticated HTTP, put the complete header value, including any `Bearer` prefix, in an environment variable through your secret manager or shell, then pass its name:

```sh
joons-mcp-probe http https://example.com/mcp --header Authorization=PROBE_TOKEN
```

`--header NAME=ENVVAR` reads the current environment value; a missing variable is a usage error. Do not put tokens in URLs or command arguments. For stdio, `--env NAME` passes a current environment value to the child. Header and passed environment values are registered for redaction. See [HTTP example](examples/probe-http.md) and [library example](examples/probe-stdio.js).

## Sample reports

Illustrative output; timestamps and timings vary. This JSON example shows the complete schema-version-1 report, including its tools excerpt.

```text
# MCP Probe: PASS

Target: stdio node examples/stdio-server.js

## Server

| Field | Value |
| --- | --- |
| Name | example-server |
| Version | 1.0.0 |
| Protocol version | 2025-11-25 |
| Capabilities | {"tools":{}} |
| Instructions present | false |

## Timings

| Step | Milliseconds |
| --- | ---: |
| Connect | 1 |
| Initialize | 2 |
| Tools list | 3 |
| Total | 6 |

## Tools

| Name | Description | Schema valid |
| --- | --- | --- |
| hello | true | true |

## Findings
```

```json
{
  "schemaVersion": 1,
  "tool": { "name": "joons-mcp-probe", "version": "0.1.0" },
  "startedAt": "2026-01-01T00:00:00.000Z",
  "finishedAt": "2026-01-01T00:00:00.006Z",
  "target": { "transport": "stdio", "command": "node", "args": ["examples/stdio-server.js"] },
  "status": "PASS",
  "server": { "name": "example-server", "version": "1.0.0", "protocolVersion": "2025-11-25", "capabilities": { "tools": {} }, "instructionsPresent": false },
  "timings": { "connectMs": 1, "initializeMs": 2, "toolsListMs": 3, "totalMs": 6 },
  "tools": { "count": 1, "pages": 1, "items": [{ "name": "hello", "hasDescription": true, "schemaValid": true }] },
  "findings": [],
  "failure": null
}
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | PASS, or WARNING with default `--fail-on fail` |
| 1 | WARNING with `--fail-on warning` |
| 2 | FAIL |
| 3 | Usage error |
| 4 | Output error |

## Using it in CI

Use `--json-out report.json` to save a machine-readable report and `--fail-on warning` to treat warnings as failures. The [GitHub Actions example](examples/github-actions.yml) uploads the report even when the probe fails. Configure secrets in your CI provider and pass their names through `--header`.

## Limitations

This is a 0.1.0 Preview, not a security audit or proof of server safety. It inspects metadata and schemas without executing tools. It supports stdio and Streamable HTTP, follows at most 50 tool-list pages, and applies timeouts and stderr limits. A server without a tools capability is reported as a warning. Reports redact known supplied secrets and HTTP URL userinfo/query values; do not rely on redaction to recognize arbitrary unknown secrets.

## More information

[API](docs/API.md) | [Architecture](docs/ARCHITECTURE.md) | [Real-world validation](docs/REAL_WORLD_VALIDATION.md) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md) | [Changelog](CHANGELOG.md) | [한국어](README.ko.md)

Windows batch targets (.cmd/.bat, including PATH/PATHEXT shims) are usage errors (3). Choose shell interpretation explicitly with: stdio -- cmd.exe /d /s /c <file>. Credential masks cover common URL/base64/base64url and Authorization echoes; Markdown and terminal JSON neutralize bidi and control characters. See docs/API.md for the exact boundary.

Every supplied non-empty secret, of any length, and its supported encoded forms is masked as a substring in all free-text values and untrusted object keys, including capabilities and displayed schemas. There is no whole-token exception. Only contract-controlled keys and fields are preserved: schemaVersion, tool metadata, timestamps, target.transport, status, timings, counts/pages, booleans/numbers, finding IDs/severity/category, failure kind/step/exitCode, and SDK-known protocol versions. Status and exit code are computed before redaction. Redacted key collisions receive deterministic numeric suffixes without discarding values. Unknown transformations and credentials remain outside this matching policy.

Inspection is bounded by totalTimeoutMs; cleanup has a separate closeTimeoutMs budget (default 3000). probe() always resolves within totalTimeoutMs + closeTimeoutMs + 1000 ms, including scheduling and report finalization. Cleanup guarantees cover the direct child, the owned POSIX process group, and Windows descendants discovered at cleanup time using taskkill and verified fallback. Descendants that detach from the tree/group cannot be guaranteed; any known survivor or unverifiable cleanup produces CLEANUP_INCOMPLETE (warning). When discovery and taskkill are both denied, unknown descendants may survive. POSIX execution and native Windows console Ctrl+C delivery remain unverified locally; configured CI is not successful-run evidence. Server data is copied iteratively with a maximum nesting depth of 64 before SDK/report use. Deeper data or cycles are replaced with [depth limit] and produce RESPONSE_TOO_DEEP (warning, connection). Redaction and renderers share the depth bound; schema checks use bounded copies and a terminable worker. A size-bounded 10,000-level response therefore resolves to a Report rather than throwing. Output write errors use exit code 4 (Amendments A1-A4).
