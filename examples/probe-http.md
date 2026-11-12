# Probe a Streamable HTTP server

Provide the full authorization header value, including its scheme, through an environment variable. The command passes the variable name, not the token itself.

```sh
# Set PROBE_TOKEN securely in your environment first, for example to a Bearer header value.
joons-mcp-probe http https://example.com/mcp --header Authorization=PROBE_TOKEN
```

For JSON output add `--format json`, or use `--json-out report.json`. Header values and URL query values are redacted in reports. Avoid putting tokens in command arguments or URLs.
