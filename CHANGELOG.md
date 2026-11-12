# Changelog

All notable changes to this project are documented in this file. The format is based on Keep a Changelog.

## [0.1.0] - 2026-11-12 Preview

### Added

- Stdio and Streamable HTTP transports for MCP server inspection.
- Tool, schema, protocol, capability, performance, and security findings.
- Timings for connection, initialization, tool listing, and total inspection.
- Failure classification for spawn, connection, handshake, protocol, response, timeout, process exit, authentication, and unknown failures.
- JSON and Markdown reports with server metadata and findings.
- CLI options for transports, timeouts, output files, failure thresholds, environment variables, and headers.
- Secret and URL redaction in reports and output.
- Read-only inspection limited to initialization, tool listing, and optional ping.

### Fixed

- Keep the first value when untrusted keys collide after masking and drop later entries in linear time, without suffixes that could recreate short secrets. Report the dropped count in one masked REDACTED_KEYS_MERGED info finding; cover 8,192-key HTTP collisions and numeric-secret JSON/Markdown regressions.
- Preserve contract-controlled report fields and compute status/exit before redaction; mask every non-empty secret and supported encoding as substrings in free text and untrusted map keys, including embedded short values.
- Include docs, examples, contributing/security pages and the Apache-2.0 license in the package; validate an offline archive and its public entry/example.
- Apply the contract owner's new Amendments A1-A4: exact deadline totalTimeoutMs + closeTimeoutMs + 1000 ms, scoped cleanup guarantees, substring/key masking, output-error exit 4 and contractual S2-S4 findings. Earlier documentation did not amend the contract.
- Bound all server data/redaction/rendering at nesting depth 64; replace deeper data with [depth limit] and RESPONSE_TOO_DEEP warning, with real 10,000-level HTTP/stdio regressions.
- Clarify global-install own-server paths versus checkout-only examples in both READMEs.

- Mask short and encoded credentials consistently, including URL/base64/base64url, Bearer and known Basic Authorization echoes in reports, errors and captured stderr.
- Bound tool/schema checks with cooperative deadlines and worker termination; large tool pages use bounded iteration rather than argument spread.
- Reject Windows .cmd/.bat commands, including PATH/PATHEXT shims, with usage exit 3; document explicit cmd.exe opt-in.
- Neutralize ANSI, C0/C1 and Unicode bidi controls in Markdown and terminal-safe JSON output.
- Contain SDK handshake/cleanup rejection paths and preserve the S2 bounded process-tree cleanup on parent exit, errors, timeout and SIGINT.
