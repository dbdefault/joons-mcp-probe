import { statSync } from 'node:fs';
import { resolve, extname, delimiter } from 'node:path';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
export const BATCH_ERROR = 'Windows batch files require a shell. Choose explicitly: stdio -- cmd.exe /d /s /c <file>';
export function stdioEnvironment(target) {
  const env = getDefaultEnvironment();
  for (const [key, value] of Object.entries(target.env ?? {})) {
    if (process.platform === 'win32') for (const old of Object.keys(env)) if (old.toUpperCase() === key.toUpperCase()) delete env[old];
    env[key] = value;
  }
  return env;
}
export function resolveStdioCommand(target) {
  if (process.platform !== 'win32') return target.command;
  if (/\.(cmd|bat)$/i.test(target.command)) throw new TypeError(BATCH_ERROR);
  const env = stdioEnvironment(target);
  const get = key => Object.entries(env).find(([k]) => k.toUpperCase() === key)?.[1];
  const cwd = resolve(target.cwd ?? process.cwd());
  const paths = /[\\/]|^[A-Za-z]:/.test(target.command) ? [''] : [cwd, ...(get('PATH') ?? '').split(delimiter)];
  const extensions = extname(target.command) ? [''] : (get('PATHEXT') ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of paths) for (const extension of extensions) {
    const candidate = resolve(cwd, dir.replace(/^"|"$/g, ''), target.command + extension);
    try {
      if (!statSync(candidate).isFile()) continue;
      if (/\.(cmd|bat)$/i.test(candidate)) throw new TypeError(BATCH_ERROR);
      return candidate;
    } catch (e) { if (e instanceof TypeError) throw e; }
  }
  return target.command;
}
