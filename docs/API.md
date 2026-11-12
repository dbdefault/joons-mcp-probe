# API reference

JOONS MCP Probe 0.1.0 requires Node.js 20 or later and uses ECMAScript modules. The public entry point exports `probe`, `checkTools`, `renderJson`, `renderMarkdown`, `redact`, and `VERSION`.

## Library

### `await probe(target, options)`

Inspects a server and resolves to a Report. Server problems produce a report with `status: "FAIL"` and a `failure`; invalid arguments throw `TypeError`.

On Windows, direct `.cmd`/`.bat` targets and targets resolving to those extensions through PATH/PATHEXT are invalid arguments (CLI usage error, exit 3). Native execution always uses `shell: false`. To choose shell interpretation explicitly, use `stdio -- cmd.exe /d /s /c <file>`; the caller then owns cmd.exe argument and quoting semantics.

Targets:

| Field | Type | Meaning |
| --- | --- | --- |
| `transport` | `"stdio"` | Launch a child process using the following fields. |
| `command` | string | Executable to spawn without a shell. |
| `args` | string[] | Argument vector; do not combine it into a shell command. |
| `cwd` | string, optional | Child working directory. |
| `env` | object of string values, optional | Environment values supplied to the child. |
| `transport` | `"http"` | Use Streamable HTTP with the following fields. |
| `url` | string | Server endpoint URL. |
| `headers` | object of string values, optional | HTTP request headers. |

Options, all optional:

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `stepTimeoutMs` | number | `10000` | Limit for an individual step, in milliseconds. |
| `totalTimeoutMs` | number | `30000` | Overall time limit, in milliseconds. |
| `maxStderrBytes` | number | `65536` | Maximum captured standard-error bytes. |
| `maxTools` | number | `10000` | Maximum collected tools across all pages. |
| `maxResponseBytes` | number | `4194304` | Maximum bytes per stdio message, HTTP JSON response, or SSE event (including framing). |
| `maxTotalResponseBytes` | number | `16777216` | Maximum cumulative incoming response bytes, including notifications and HTTP error bodies. |
| `closeTimeoutMs` | number | `3000` | Additional cleanup budget after inspection; cleanup uncertainty is a warning. |
| `slowThresholdMs` | number | `2000` | A step taking longer triggers `SLOW_STEP`. |
| `secrets` | string[] | omitted | Additional exact strings to mask in reports; no default values are specified. |

Inspection is bounded by totalTimeoutMs; cleanup has a separate closeTimeoutMs budget (default 3000). probe() always resolves within totalTimeoutMs + closeTimeoutMs + 1000 ms, including scheduling and report finalization.

### `checkTools(rawTools)`

Pure, synchronous inspection of the raw tools array: returns `{ items, findings }` with no I/O. Call it after a server advertises the tools capability. An empty array produces `TOOLS_EMPTY`; a non-array currently returns empty arrays. Each item has `{ name, hasDescription, schemaValid }`; `name` is the string provided by the server or `null` if missing or non-string. `schemaValid` concerns the input schema, not the optional output schema. Findings use the shape below. Repeated names generate a duplicate finding for each occurrence after the first.

`checkTools(rawTools, { deadline })` also accepts an absolute `Date.now()` deadline. It checks elapsed time between tools, copying stages and schema compilations and returns a bounded partial result with `budgetExceeded: true` and `CHECKS_BUDGET_EXCEEDED` when exhausted. Direct synchronous calls cannot interrupt a single Ajv compilation; `probe()` runs checks in a terminable worker, enforces the earlier step/total deadline, and reports `timeout` plus `SLOW_STEP`/`CHECKS_BUDGET_EXCEEDED` if exhausted. `tools.count` counts collected entries; partial `tools.items` contains only completed checks.

Schemas must have `type: "object"` and compile with Ajv 8. The checker accepts draft-07 and draft 2020-12; it uses `strict: false`, `allErrors: true`, and disables format validation, so unknown formats are allowed. Cycles, unsafe keys, accessors and inputs exceeding checker limits are rejected as invalid. Do not treat a successful compile as validation of a tool's runtime behavior.

### Renderers and redaction

- `renderJson(report)` returns a JSON string.
- `renderMarkdown(report)` returns a Markdown string. Server-provided text is escaped and truncated as described in [ARCHITECTURE.md](ARCHITECTURE.md).
- `redact(value, secrets = [])` masks untrusted string values and keys; Report objects use the contract-controlled path exemptions below. Library and CLI share this implementation.
- `VERSION` is the string `"0.1.0"`.

Credential masks include URL percent encoding (including lowercase escapes and form-style spaces), UTF-8 base64 (padded/unpadded) and base64url, and those encodings of `Bearer <secret>` and `user:<secret>`. Supplied Authorization values, Bearer tokens, decoded Basic credentials and known URL credential pairs are registered. Masks apply to free-text values before escaping/truncation, including server name/version/instructions text, displayed tool names/descriptions, capability string values, target command/args/URL, finding message/tool text, failure.message, and captured stderr.

Every supplied non-empty secret, of any length, and its supported encoded forms is masked as a substring in all free-text values and untrusted object keys, including capabilities and displayed schemas. There is no whole-token exception. Only contract-controlled keys and fields are preserved: schemaVersion, tool metadata, timestamps, target.transport, status, timings, counts/pages, booleans/numbers, finding IDs/severity/category, failure kind/step/exitCode, and SDK-known protocol versions. Status and exit code are computed before redaction. When keys collide after masking, the first value is retained and later entries are dropped in linear time, without generated suffixes. One REDACTED_KEYS_MERGED info finding reports the dropped-entry count; its message is also masked. Unknown transformations and credentials remain outside this matching policy.

Server data is copied iteratively with a maximum nesting depth of 64 before SDK/report use. Deeper data or cycles are replaced with [depth limit] and produce RESPONSE_TOO_DEEP (warning, connection). Redaction and renderers share the depth bound; schema checks use bounded copies and a terminable worker. A size-bounded 10,000-level response therefore resolves to a Report rather than throwing.

Markdown strips ANSI sequences, C0/C1 controls and Unicode bidi controls (U+202A–U+202E, U+2066–U+2069, U+200E/U+200F/U+061C) before escaping and truncation. JSON serialization uses visible JSON Unicode escapes for active C1/bidi characters; parsing it restores the original control data. CLI stdout is terminal-safe in both formats. Direct library report strings retain machine data, so consumers rendering those strings must apply their own human-output boundary.

## Report schema, version 1

All durations are rounded integer milliseconds; a timing for a step that did not run is `null`. A report contains:

| Field | Type | Meaning and null rules |
| --- | --- | --- |
| `schemaVersion` | integer | `1`. |
| `tool` | object | Probe identity. |
| `tool.name` | string | `joons-mcp-probe`. |
| `tool.version` | string | `0.1.0`. |
| `startedAt`, `finishedAt` | strings | ISO-8601 timestamps. |
| `target` | object | Sanitized target representation, described below. |
| `status` | `"PASS"`, `"WARNING"`, or `"FAIL"` | Derived as specified below. |
| `server` | object or `null` | Server metadata when available; otherwise `null`. |
| `server.name`, `server.version` | strings | Server-reported identity; missing data is flagged by `SERVER_INFO_INCOMPLETE`. |
| `server.protocolVersion` | string | Negotiated protocol version. |
| `server.capabilities` | object | Advertised capabilities. |
| `server.instructionsPresent` | boolean | Whether instructions were present. |
| `timings` | object | Step and total durations. |
| `timings.connectMs`, `timings.initializeMs`, `timings.toolsListMs`, `timings.totalMs` | integer or `null` | Rounded durations; `null` if the corresponding step did not run. Total includes closing. |
| `tools` | object or `null` | Tool summary when listing ran and produced a summary; otherwise `null`. |
| `tools.count` | integer | Number of listed tools. |
| `tools.pages` | integer | Number of pages collected. |
| `tools.items` | array | Tool summaries in listing order. |
| `tools.items[].name` | string or `null` | Server name, or `null` when absent or non-string. |
| `tools.items[].hasDescription` | boolean | Description is a nonblank string. |
| `tools.items[].schemaValid` | boolean | Input schema is object-typed and compiles. |
| `findings` | array | Zero or more finding objects below. |
| `failure` | object or `null` | Failure details, or `null` if there was no operational failure. |

For stdio, `target` has `transport: "stdio"`, `command: string`, and `args: string[]`. For HTTP it has `transport: "http"` and `url: string`; URL userinfo and query values are removed or masked. Credentials, environment values and headers must not be exposed in output.

Each finding has `id: string`, `severity: "fail" | "warning" | "info"`, `category: "connection" | "protocol" | "tools" | "schema" | "performance" | "security"`, and `message: string`. It may have `tool: string` identifying the associated tool. `tool` is omitted when unavailable. Findings are not failures themselves: they affect status through severity.

A non-null `failure` has `kind` from the failure table below, `step: "connect" | "initialize" | "tools_list" | "close"`, a redacted `message: string`, `exitCode: integer | null`, and `stderrTail: string`, containing at most the last 2,000 redacted characters. The contract does not specify additional nullability for other failure fields.

Status precedence: `FAIL` if `failure` is non-null or any finding has severity `fail`; otherwise `WARNING` if any finding has severity `warning`; otherwise `PASS`. Info findings alone do not change PASS.

## Findings

Categories for the checks module are fixed by its implementation. Core finding categories below are the corresponding contract categories; the contract does not assign each core ID to a specific category, so these are descriptive classifications, not a verified implementation mapping.

| ID | Severity | Category | Meaning | How to fix |
| --- | --- | --- | --- | --- |
| `TOOLS_EMPTY` | warning | tools | Capability exists but no tools were returned. | Expose the intended tools, or remove the capability if none are offered. |
| `TOOL_NAME_MISSING` | fail | tools | Name is absent or not a string. | Supply a string name. |
| `TOOL_NAME_INVALID` | warning | tools | Name does not match `^[A-Za-z0-9_.-]{1,128}$`. | Use 1–128 allowed characters. |
| `TOOL_NAME_DUPLICATE` | fail | tools | The same name occurs more than once. | Give each tool a unique name. |
| `TOOL_DESCRIPTION_MISSING` | warning | tools | Description is absent or blank. | Add a useful nonblank description. |
| `TOOL_SCHEMA_MISSING` | fail | schema | `inputSchema` is absent. | Supply an object-typed input schema. |
| `TOOL_SCHEMA_NOT_OBJECT` | fail | schema | Input schema type is not `object`. | Set the root schema type to `object`. |
| `TOOL_SCHEMA_INVALID` | fail | schema | Input schema cannot be safely compiled. | Correct schema keywords and references and stay within checker bounds. |
| `TOOL_OUTPUT_SCHEMA_INVALID` | warning | schema | Present output schema is not object-typed or cannot compile. | Correct it or omit it when unnecessary. |
| `TOOLS_PAGINATION_LOOP` | fail | tools | A cursor repeats or the list exceeds 50 pages. | Correct pagination and ensure it terminates within the limit. |
| `PROTOCOL_VERSION_UNSUPPORTED` | fail | protocol | Negotiated version is not SDK-supported. | Upgrade or configure compatible protocol versions. |
| `PROTOCOL_VERSION_OLD` | info | protocol | Negotiated version is older than the SDK latest. | Upgrade the server when practical. |
| `CAPABILITY_TOOLS_MISSING` | warning | protocol | Server did not advertise tools. | Advertise tools if the server supports them. |
| `SERVER_INFO_INCOMPLETE` | warning | protocol | Server name or version is missing. | Include both values in server information. |
| `SLOW_STEP` | warning | performance | A step exceeded the configured slow threshold. | Investigate server latency or adjust the threshold for the environment. |
| `CHECKS_BUDGET_EXCEEDED` | warning | performance | Tool/schema checks stopped at the step or total budget; probe failure kind is `timeout`. | Reduce schema complexity/tool count or adjust the time budget. |
| `STDERR_TRUNCATED` | info | connection | Standard error exceeded its capture limit. | Reduce stderr output or adjust `maxStderrBytes`. |
| `RESPONSE_TOO_DEEP` | warning | connection | Nesting exceeded 64; deeper parts were replaced with [depth limit]. | Reduce response nesting. |
| `CLEANUP_INCOMPLETE` | warning | connection | Cleanup exceeded its deadline or the process tree could not be verified gone; includes redacted taskkill diagnostics when available. | Inspect process permissions and remaining owned processes. |
| `TOOLS_LIMIT_EXCEEDED` | fail | tools | Collected tools exceed `maxTools`; only the bounded prefix is checked. | Reduce the list or raise the bound explicitly. |
| `RESPONSE_TOO_LARGE` | fail | connection | A message or cumulative response bytes exceed the configured bound; failure kind is `invalid_response`. | Reduce server output or raise the relevant bound. |
| `SECRET_IN_RESPONSE` | warning | security | A supplied secret appeared in server output. | Stop returning secrets and rotate any exposed credential as appropriate. |
| `REDACTED_KEYS_MERGED` | info | security | Masked object keys collided; first values were kept and later entries dropped. One finding reports the total dropped count (subject to secret masking). | Inspect the source data without exposing credentials if the dropped entries matter. |

## Failure kinds

These are typical causes and checks, not a guaranteed one-to-one diagnosis.

| `kind` | Typical cause | What to check |
| --- | --- | --- |
| `spawn_failed` | Executable could not be started. | Command, arguments, working directory and execution permissions. |
| `connection_refused` | Endpoint is not accepting connections. | Server availability, URL and network access. |
| `handshake_failed` | Initialization failed. | Server startup and initialize response. |
| `protocol_mismatch` | Protocol negotiation failed. | Client and server supported versions. |
| `invalid_response` | Response is malformed or violates the expected envelope. | Server response shape and pagination fields. |
| `timeout` | A step or total deadline elapsed. | Server responsiveness and timeout settings. |
| `process_exited` | Child process exited during inspection. | Exit code and redacted stderr tail. |
| `auth_failed` | Server rejected authentication. | Required credentials, header name and authorization. |
| `unknown` | Failure did not match another classification. | Failure step, message and stderr tail. |

## CLI

```text
joons-mcp-probe stdio [--cwd DIR] [--env NAME ...] -- <command> [args...]
joons-mcp-probe http <url> [--header NAME=ENVVAR ...]
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--cwd DIR` | Child working directory, stdio only. | Not specified. |
| `--env NAME` | Pass the current value of this environment variable to the child; repeat for multiple names. | SDK default safe environment. |
| `--header NAME=ENVVAR` | Read an HTTP header value from the named environment variable; repeat as needed. A missing variable is a usage error. | No extra headers specified. |
| `--step-timeout MS` | Per-step timeout. | `10000`. |
| `--total-timeout MS` | Overall timeout. | `30000`. |
| `--slow MS` | Slow-step threshold. | `2000`. |
| `--format json\|markdown` | Standard output format. | `markdown`. |
| `--json-out FILE` | Write JSON report to a file. | No JSON output file. |
| `--md-out FILE` | Write Markdown report to a file. | No Markdown output file. |
| `--fail-on warning\|fail` | Lowest severity that causes a nonzero result. | `fail`. |
| `--quiet` | Suppress standard output. | Not enabled. |
| `--help` | Display help. | Not enabled. |
| `--version` | Display version. | Not enabled. |

Header and `--env` values are added to the secret mask automatically. The stdio command and arguments are passed as an argument vector with `shell: false`.

| Exit code | Meaning |
| --- | --- |
| `0` | PASS, or WARNING with `--fail-on fail`. |
| `1` | WARNING with `--fail-on warning`. |
| `2` | FAIL. |
| `3` | Usage error. |
| `4` | Output error: stdout or a report file could not be written. |

## Cleanup and validation limits

The contract owner has now adopted Amendments A1-A4. Cleanup guarantees cover the direct child, the owned POSIX process group, and Windows descendants discovered at cleanup time using taskkill and verified fallback. Descendants that detach from the tree/group cannot be guaranteed; any known survivor or unverifiable cleanup produces CLEANUP_INCOMPLETE (warning). When discovery and taskkill are both denied, unknown descendants may survive. POSIX execution and native Windows console Ctrl+C delivery remain unverified locally; configured CI is not successful-run evidence. Exit code 4 means an output write error; S2-S4 findings are contractual.

Windows Node 24 is the locally exercised environment. Native Windows console-control delivery, POSIX execution/reaping, and Node 20/22 remain unverified locally. CI configures the OS/Node matrix and uploads per-job JUnit/smoke reports; successful remote matrix execution must be verified separately. The offline package check creates/extracts a local archive, verifies README links/docs/examples, and runs its CLI/public entry with the already-installed dependencies; it does not install dependencies or prove an isolated clean installation.

## Examples

Run these after installing or integrating the package; examples that inspect a server require an MCP server at the supplied command or endpoint.

```sh
joons-mcp-probe --version
```

```sh
joons-mcp-probe stdio -- node server.js
```

```sh
joons-mcp-probe http https://example.com/mcp --format json --fail-on warning
```

```sh
joons-mcp-probe stdio --step-timeout 5000 --total-timeout 20000 -- node server.js
```

```js
import { checkTools } from 'joons-mcp-probe';
const result = checkTools([{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } }]);
console.log(result);
```

```js
import { probe, renderJson } from 'joons-mcp-probe';
const report = await probe({ transport: 'stdio', command: 'node', args: ['server.js'] }, { stepTimeoutMs: 5000 });
console.log(renderJson(report));
```
