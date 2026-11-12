# MCP test fixtures

Run scripts with Node and an argv array. Standard I/O uses newline-delimited JSON-RPC. The valid stdio and HTTP fixtures use the installed MCP SDK; malformed cases use raw JSON-RPC. Close stdin or send SIGTERM to stop a fixture. The deliberately detached test grandchild must be cleaned up by the caller.

| Script | Behavior |
| --- | --- |
| ok-stdio.js | Two valid tools, server info and instructions. |
| ok-http.js | Streamable HTTP on loopback and an ephemeral port; prints `LISTENING <port>`. When `FIXTURE_TOKEN` is set, requires `Authorization: Bearer <token>`. |
| http-auth.js | Requires the bearer token in `FIXTURE_TOKEN`; rejects with 401 and `WWW-Authenticate: Bearer`, or 403 when `FIXTURE_AUTH_STATUS=403`. |
| http-bad-json.js | Returns HTTP 200 with JSON content type and a malformed body. |
| http-wrong-content-type.js | Returns HTTP 200 with HTML content type. |
| http-hang.js | Accepts requests and never responds; stdin close terminates active connections. |
| http-500.js | Returns HTTP 500 with `FIXTURE_SECRET` in the body. |
| http-sse.js | Valid Streamable HTTP server using SSE response framing. |
| handshake-fail.js | Initialize returns a JSON-RPC error. |
| bad-protocol.js | Initialize reports protocol version `1999-01-01`. |
| dup-tools.js | Lists two tools with the same name. |
| bad-schema.js | Lists schemas with a non-object type and invalid properties. |
| empty-tools.js | Advertises tools but lists none. |
| no-description.js | Lists a tool without a description. |
| slow.js | Delays initialization; first argument or `FIXTURE_DELAY_MS` sets milliseconds (default 5000). |
| early-exit.js | Writes a diagnostic to stderr and exits with code 3. |
| garbage.js | Writes non-JSON and does not answer requests. |
| echo-secret.js | Uses `FIXTURE_SECRET` as a tool description. |
| spawns-child.js | Starts a sleeping child and writes its PID to the first argument. Caller must kill it; this tests process-tree cleanup. |
| paginated.js | Returns three pages; first argument `loop` or `FIXTURE_LOOP=1` repeats a cursor. |
| tool-call-tripwire.js | Appends any disallowed method to the file in the first argument. |

`run-http.js` exports `startHttpFixture(scriptPath, env)`, which starts the HTTP server and returns its URL and an async `close()` function. `getFreeClosedPort()` returns an ephemeral port after closing its listener; another process can claim the port before it is used.

Run the fixture self-tests with `node --test test/fixtures-selftest.test.js test/fixtures-http-selftest.test.js`. The integration tests skip when the public API is unavailable.

For process cleanup checks, `FIXTURE_PID_FILE` optionally records the fixture's own PID before it starts handling requests.
