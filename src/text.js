const bidi = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const ansi = /(?:\u001b\][\s\S]*?(?:\u0007|\u001b\\))|(?:(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~])|(?:\u001b[@-_])/g;
export function humanText(value) {
  return String(value).replace(ansi, '').replace(bidi, '').replace(/\r\n|\r|\n/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}
// JSON-compatible escapes preserve machine data while preventing terminal effects.
export function terminalText(value) {
  return String(value).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
