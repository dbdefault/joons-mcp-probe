import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFreeClosedPort, startHttpFixture } from './fixtures/run-http.js';

const script = name => join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'servers', `${name}.js`);
const init = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture-test', version: '1.0.0' } };
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: init });
const post = (url, extra = {}) => fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(3000), ...extra });

for (const status of [401, 403]) {
  test(`http-auth denies with ${status} and accepts the configured bearer`, async () => {
    const token = 'fixture-token-value';
    const fixture = await startHttpFixture(script('http-auth'), { FIXTURE_TOKEN: token, FIXTURE_AUTH_STATUS: String(status) });
    try {
      const denied = await post(fixture.url);
      assert.equal(denied.status, status);
      assert.match(denied.headers.get('www-authenticate'), /Bearer/i);
      assert.equal((await post(fixture.url, { headers: { ...headers, authorization: 'Bearer wrong' } })).status, status);
      const accepted = await post(fixture.url, { headers: { ...headers, authorization: `Bearer ${token}` } });
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).result.serverInfo.name, 'fixture-server');
    } finally { await fixture.close(); }
  });
}

test('http-bad-json returns malformed JSON with JSON content type', async () => {
  const fixture = await startHttpFixture(script('http-bad-json'));
  try {
    const response = await post(fixture.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.equal(await response.text(), 'not json');
  } finally { await fixture.close(); }
});

test('http-wrong-content-type returns HTML', async () => {
  const fixture = await startHttpFixture(script('http-wrong-content-type'));
  try {
    const response = await post(fixture.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(await response.text(), /<html>/);
  } finally { await fixture.close(); }
});

test('http-hang accepts a request without answering and closes cleanly', async () => {
  const fixture = await startHttpFixture(script('http-hang'));
  try {
    await assert.rejects(post(fixture.url, { signal: AbortSignal.timeout(300) }), { name: 'TimeoutError' });
  } finally { await fixture.close(); }
});

test('http-500 includes the configured secret in its error body', async () => {
  const secret = 'fixture-secret-value';
  const fixture = await startHttpFixture(script('http-500'), { FIXTURE_SECRET: secret });
  try {
    const response = await post(fixture.url);
    assert.equal(response.status, 500);
    assert.ok((await response.text()).includes(secret));
  } finally { await fixture.close(); }
});

test('http-sse frames initialize and tools/list as SSE', async () => {
  const fixture = await startHttpFixture(script('http-sse'));
  try {
    const response = await post(fixture.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/event-stream/);
    const event = await response.text();
    assert.match(event, /event: message/);
    const data = JSON.parse(event.match(/^data: (.+)$/m)[1]);
    assert.equal(data.id, 1);
    assert.equal(data.result.serverInfo.name, 'fixture-server');
    const session = response.headers.get('mcp-session-id');
    assert.ok(session);
    const sessionHeaders = { ...headers, 'mcp-session-id': session, 'mcp-protocol-version': init.protocolVersion };
    const notified = await post(fixture.url, { headers: sessionHeaders, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.equal(notified.status, 202);
    const list = await post(fixture.url, { headers: sessionHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    assert.match(list.headers.get('content-type'), /^text\/event-stream/);
    const listEvent = await list.text();
    assert.equal(JSON.parse(listEvent.match(/^data: (.+)$/m)[1]).result.tools.length, 2);
  } finally { await fixture.close(); }
});

test('getFreeClosedPort returns a port without a listener', async () => {
  const port = await getFreeClosedPort();
  assert.ok(Number.isInteger(port) && port > 0);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/mcp`, { signal: AbortSignal.timeout(3000) }), error => error.cause?.code === 'ECONNREFUSED');
});
