# Real-world validation

This page records how JOONS MCP Probe 0.1.0 behaved against a real, production MCP server, without disclosing anything about that server beyond what is needed to understand the results. Host names, paths, addresses, tool names and deployment details are intentionally omitted.

## The server under test

- A private production MCP server with roughly a hundred tools, written in Node.js on the official MCP SDK.
- Normally reached over stdio by local clients (each client starts its own short-lived server process), and over Streamable HTTP through a gateway protected by OAuth 2.1.
- Windows host, Node.js 24.

## Procedure

1. Install Probe from the release tag into an isolated folder, without touching global settings:

   ```sh
   npm install --prefix ./probe-inst github:dbdefault/joons-mcp-probe#v0.1.0
   node ./probe-inst/node_modules/joons-mcp-probe/bin/joons-mcp-probe.js --version
   ```

2. Choose the safest connection: the same stdio entry point that ordinary clients use, so the probe starts a temporary server process exactly like a normal client would, without restarting or reconfiguring the running service.

   ```sh
   joons-mcp-probe stdio --format json --json-out report.json --md-out report.md -- node /path/to/server-entry.mjs
   ```

3. Repeat five times under the same conditions, two seconds apart, and compare the process list and listening ports before and after.
4. Prove read-only behaviour by placing a transparent relay between the probe and the server that records only JSON-RPC method names.
5. Check failure classification against the real environment: no credentials over HTTP, a closed port, and a deliberately short time limit.

Calling tools, reading resources and fetching prompts were out of scope, and the authenticated HTTP path was skipped because obtaining a token requires an interactive OAuth consent.

## Results

| Check | Result |
|---|---|
| Install from the git tag | Succeeded in about 30 s; 31 package files, CLI help and version correct |
| Handshake | Protocol 2025-11-25, server info and capabilities reported |
| Tool contract | About a hundred tools, all names valid, no duplicates, no missing descriptions, all input schemas compiled |
| Methods sent (relay log) | `initialize`, `notifications/initialized`, `tools/list` only |
| Service state before and after | Identical process list and listening ports |
| Processes left behind | None, also after a timeout |
| HTTP without credentials | FAIL, `auth_failed`, in under 0.3 s |
| Closed port | FAIL, `connection_refused` |
| Short time limit | FAIL, `timeout`, within the documented maximum time |

Timings over five stdio runs (median / maximum): connect 12 / 13 ms, initialize 3.4 / 4.4 s, tools/list 357 / 418 ms, total 5.8 / 6.4 s. Initialize includes the server's own start-up, because every stdio probe starts a fresh server process.

## What we learned

- **Tool counts depend on the child environment.** Probe passes only a minimal, safe set of environment variables to the server process. Our server registers some tools only when a particular environment variable is set, so the default run listed two fewer tools than the running service. Passing that variable with `--env NAME` produced an exact match. If your tool count looks low, check for environment-gated tools before suspecting the server.
- **Cold start counts as initialize time.** A heavy stdio server can exceed the default slow threshold of 2 s on every run. Use `--slow <ms>` to set a threshold that fits your server.
- **Some warnings were noise in this environment.** A process-tree snapshot occasionally could not be taken, which produced a cleanup warning even though no process was left; and values passed with `--env` are treated as secrets, so a short setting such as `1` can trigger a secret warning. Both are tracked for the next release. Until then, prefer `--fail-on fail` (the default) in CI.
- **Reports can contain local paths.** The JSON report records the command and arguments you ran. Review it before sharing it publicly.

## Using Probe the same way

- Probe the stdio entry point your clients already use, and pass only the environment variables the server needs.
- Keep tool calls out of diagnostics; Probe never sends them.
- Treat the report as a snapshot of one start-up of your server, and compare several runs before drawing performance conclusions.
