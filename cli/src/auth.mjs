// The ValyroUI token: `valyro login` stores it, the registry sends it to the licensed API only.
// VALYRO_TOKEN overrides the stored token (CI); VALYRO_CONFIG_DIR moves the file (tests);
// VALYRO_API_URL points the account commands at another API (a local server in tests).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { API_URL } from './constants.mjs';
import { CliError } from './registry.mjs';

/** @param {Record<string, string | undefined>} env */
export function configDir(env) {
  return (
    env.VALYRO_CONFIG_DIR ??
    (process.platform === 'win32' && env.APPDATA ? path.join(env.APPDATA, 'valyro') : path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'valyro'))
  );
}

export const authFile = (env) => path.join(configDir(env), 'auth.json');

/** The account API base URL (or `base`, another API of the same server), without a trailing slash. Plain http only for a local server. */
export function apiUrl(env, base = API_URL) {
  const value = env.VALYRO_API_URL?.trim();
  if (!value) return base;
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new CliError(`VALYRO_API_URL is not a URL: ${value}`, { cause: error });
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new CliError('VALYRO_API_URL must use https (plain http only for localhost).');
  return url.href.replace(/\/+$/, '');
}

/** The token saved by `valyro login` (not VALYRO_TOKEN). @returns {string | null} */
export function readSavedToken(env) {
  const file = authFile(env);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new CliError(`Cannot read ${file}: ${error.message}`, { cause: error });
  }
  try {
    const { token } = JSON.parse(text);
    return typeof token === 'string' && token ? token : null;
  } catch (error) {
    throw new CliError(`${file} is not valid JSON; delete it and run \`valyro login\` again.`, { cause: error });
  }
}

/** VALYRO_TOKEN, else the saved token. @returns {string | null} */
export function readToken(env) {
  if (env.VALYRO_TOKEN?.trim()) return env.VALYRO_TOKEN.trim();
  return readSavedToken(env);
}

/** Tokens are opaque; this only rejects obvious paste mistakes (spaces, quotes, an empty line). */
export function validateToken(token) {
  const value = token.trim();
  if (!value) throw new CliError('No token given.');
  if (!/^[\w.~+/=-]{16,4100}$/.test(value)) throw new CliError('That does not look like a ValyroUI token: copy it again from the account page.');
  return value;
}

/** Writes the token readable by the current user only. @returns {string} the file */
export function saveToken(env, token, { login = null } = {}) {
  const file = authFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({ token, login, savedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

/** Deletes the saved token. @returns {boolean} false when there was none */
export function deleteToken(env) {
  try {
    fs.unlinkSync(authFile(env));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new CliError(`Cannot delete ${authFile(env)}: ${error.message}`, { cause: error });
  }
}
