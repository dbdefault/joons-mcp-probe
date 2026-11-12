export function diagnose(error, step, state = {}) {
  const chain = [];
  const visit = e => { if (!e || chain.includes(e)) return; chain.push(e); visit(e.cause); for (const nested of e.errors ?? []) visit(nested); };
  visit(error);
  const message = error?.message ?? String(error);
  const codes = chain.map(e => e.code ?? e.status);
  let kind = 'unknown';
  if (error?.kind) kind = error.kind;
  else if (codes.includes('ENOENT')) kind = 'spawn_failed';
  else if (codes.includes('ECONNREFUSED')) kind = 'connection_refused';
  else if (codes.some(c => c === 401 || c === 403) || error?.name === 'UnauthorizedError') kind = 'auth_failed';
  else if (/protocol version.*not supported/i.test(message)) kind = 'protocol_mismatch';
  else if (state.exited) kind = 'process_exited';
  else if (error?.name === 'ZodError' || /JSON|invalid.*(result|response)|parse|Unexpected content type/i.test(message)) kind = 'invalid_response';
  else if (step === 'initialize') kind = 'handshake_failed';
  return { kind, step, message, exitCode: state.exitCode ?? null, stderrTail: state.stderrTail ?? '' };
}
