export const MAX_DATA_DEPTH = 64;
export const DEPTH_MARKER = '[depth limit]';

// Constant-time insertion: preserve the first own value; never invent suffix material.
export function putData(out, requested, value, onCollision = () => {}) {
  if (Object.hasOwn(out, requested)) { onCollision(); return; }
  Object.defineProperty(out, requested, { value, enumerable: true, configurable: true, writable: true });
}

// Explicit DFS frames: input nesting never consumes the JS call stack.
export function boundData(root, { mapString = s => s, mapKey = s => s, onLimit = () => {}, onCollision = () => {}, maxDepth = MAX_DATA_DEPTH } = {}) {
  const active = new WeakSet();
  const frames = [];
  const node = (value, depth) => {
    if (typeof value === 'string') return mapString(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth >= maxDepth || active.has(value)) { onLimit(); return DEPTH_MARKER; }
    const array = Array.isArray(value), out = array ? [] : {};
    active.add(value);
    frames.push({ source: value, out, array, keys: array ? null : Object.keys(value), index: 0, depth });
    return out;
  };
  const result = node(root, 0);
  while (frames.length) {
    const frame = frames[frames.length - 1];
    const length = frame.array ? frame.source.length : frame.keys.length;
    if (frame.index >= length) { active.delete(frame.source); frames.pop(); continue; }
    const key = frame.array ? String(frame.index++) : frame.keys[frame.index++];
    const mappedKey = frame.array ? key : mapKey(key);
    // Drop the entire later entry before visiting its value or allocating a subtree.
    if (!frame.array && Object.hasOwn(frame.out, mappedKey)) { onCollision(); continue; }
    const descriptor = Object.getOwnPropertyDescriptor(frame.source, key);
    if (!descriptor || !('value' in descriptor)) { onLimit(); if (frame.array) frame.out.push(DEPTH_MARKER); else putData(frame.out, mappedKey, DEPTH_MARKER); continue; }
    const child = node(descriptor.value, frame.depth + 1);
    if (frame.array) frame.out.push(child); else putData(frame.out, mappedKey, child);
  }
  return result;
}

export function addDepthFinding(report) {
  report.findings ??= [];
  if (!report.findings.some(f => f.id === 'RESPONSE_TOO_DEEP')) report.findings.push({ id: 'RESPONSE_TOO_DEEP', severity: 'warning', category: 'connection', message: 'Server data exceeded the maximum nesting depth of 64; deeper data was replaced.' });
}
export function boundReport(report) {
  let limited = false;
  const copy = boundData(report, { onLimit: () => { limited = true; } });
  if (limited) {
    addDepthFinding(copy);
    // Decide on the unredacted bounded structure before any presentation transformation.
    copy.status = copy.failure || copy.findings.some(f => f.severity === 'fail') ? 'FAIL' : 'WARNING';
  }
  return copy;
}
