// login / logout / whoami against the account API (server/index.mjs documents the endpoints).
// `valyro login` signs in through the browser like `gh auth login`: the API hands out a one-time code,
// the user approves it on valyro.xyz while the CLI polls, and the CLI saves the token it gets back.

import os from 'node:os';
import { apiUrl, authFile, deleteToken, readSavedToken, readToken, saveToken, validateToken } from './auth.mjs';
import { CLI_PACKAGE, PRICING_URL, SITE_URL } from './constants.mjs';
import { CliError } from './registry.mjs';

const TIMEOUT_MS = 20_000;
const sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One JSON call to the account API. @returns {Promise<{ status: number, ok: boolean, data: any }>} */
async function api(io, method, pathname, { token, body } = {}) {
  const url = `${apiUrl(io.env)}${pathname}`;
  let response;
  try {
    response = await io.fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new CliError(`Cannot reach ${url}: ${error.message}`, { cause: error });
  }
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
    throw new CliError(`${url} answered ${response.status} without JSON: the ValyroUI API is not reachable there.`);
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new CliError(`${url} sent malformed JSON`, { cause: error });
  }
  return { status: response.status, ok: response.ok, data };
}

const planName = (plan) => ((typeof plan === 'string' ? plan : plan?.tier) === 'pro' ? 'ValyroUI Pro' : 'free plan');

/**
 * Browser sign-in (device code), or `--token <token>` for CI and pasted tokens. VALYRO_TOKEN in the
 * environment works without login.
 */
export async function login(opts, io) {
  if (opts.token !== undefined) {
    const file = saveToken(io.env, validateToken(opts.token));
    io.out(`Saved the token to ${file}. Pro components now install with \`${CLI_PACKAGE} add <name>\`.`);
    if (io.env.VALYRO_TOKEN) io.err('Note: VALYRO_TOKEN is set and takes precedence over the saved token.');
    return 0;
  }

  const start = await api(io, 'POST', '/cli/device', { body: { name: `valyro CLI on ${os.hostname()}`.slice(0, 64) } });
  const { device_code: deviceCode, user_code: userCode, verification_url: verificationUrl, expires_in: expiresIn } = start.data ?? {};
  if (!start.ok || typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUrl !== 'string') {
    throw new CliError(
      `Could not start the sign-in: ${start.data?.message ?? `HTTP ${start.status}`} Or create a token at ${SITE_URL}/#/account and run \`${CLI_PACKAGE} login --token <token>\`.`,
    );
  }
  let interval = Number.isFinite(start.data.interval) ? start.data.interval : 5;
  io.out(`Your one-time code: ${userCode}`);
  io.out(`Approve it at ${verificationUrl} (signed in with GitHub) within ${Math.round((expiresIn ?? 600) / 60)} minutes.`);
  if (!opts['no-browser']) io.open?.(verificationUrl);
  io.out('Waiting for approval…');

  const sleep = io.sleep ?? sleeper;
  for (;;) {
    await sleep(interval * 1000);
    const poll = await api(io, 'POST', '/cli/device/token', { body: { device_code: deviceCode } });
    if (poll.ok) {
      const token = validateToken(String(poll.data?.token ?? ''));
      const login = typeof poll.data.login === 'string' ? poll.data.login : null;
      const file = saveToken(io.env, token, { login });
      io.out(`Logged in as ${login ?? 'your account'}. Saved the token to ${file}.`);
      await reportPlan(io, token);
      if (io.env.VALYRO_TOKEN) io.err('Note: VALYRO_TOKEN is set and takes precedence over the saved token.');
      return 0;
    }
    switch (poll.data?.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval = Number.isFinite(poll.data.interval) ? poll.data.interval : interval + 5;
        continue;
      case 'expired_token':
        throw new CliError('The code expired before it was approved. Run `valyro login` again.');
      case 'access_denied':
        throw new CliError('The sign-in was denied in the browser.');
      default:
        throw new CliError(`Sign-in failed: ${poll.data?.message ?? `HTTP ${poll.status}`}`);
    }
  }
}

/** After login: the plan, so a free account learns why Pro items still fail. A failure here is only a warning. */
async function reportPlan(io, token) {
  try {
    const me = await api(io, 'GET', '/me', { token });
    if (!me.ok) throw new CliError(me.data?.message ?? `HTTP ${me.status}`);
    const pro = planName(me.data.plan) === 'ValyroUI Pro';
    io.out(pro ? 'Plan: ValyroUI Pro. Pro components install with `valyro add <name>`.' : `Plan: free. Pro components: ${PRICING_URL}`);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    io.err(`warning: could not read your plan (${error.message}); \`valyro whoami\` shows it.`);
  }
}

/** Revokes the saved token on the server, then deletes it locally (also when the server cannot be reached). */
export async function logout(opts, io) {
  const token = readSavedToken(io.env);
  if (!token) {
    io.out('Not logged in: no saved token.');
    if (io.env.VALYRO_TOKEN) io.err('Note: VALYRO_TOKEN is set in the environment; unset it to stop using that token.');
    return 0;
  }
  try {
    const answer = await api(io, 'DELETE', '/tokens/current', { token });
    if (answer.ok) io.out(answer.data?.revoked ? 'Revoked the token on the server.' : 'This older token cannot be revoked; it expires on its own.');
    else if (answer.status === 401) io.out('The token was already revoked or expired.');
    else throw new CliError(answer.data?.message ?? `HTTP ${answer.status}`);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    io.err(`warning: could not revoke the token on the server (${error.message}). Revoke it on the account page.`);
  }
  deleteToken(io.env);
  io.out(`Removed ${authFile(io.env)}.`);
  if (io.env.VALYRO_TOKEN) io.err('Note: VALYRO_TOKEN is still set in the environment.');
  return 0;
}

/** The account and plan of the token in use. */
export async function whoami(opts, io) {
  const token = readToken(io.env);
  if (!token) throw new CliError(`Not logged in. Run \`npx ${CLI_PACKAGE} login\`.`);
  const me = await api(io, 'GET', '/me', { token });
  if (me.status === 401) throw new CliError('Your token was not accepted (revoked or expired). Run `valyro login` again.');
  if (!me.ok || typeof me.data?.user?.login !== 'string') throw new CliError(`Could not read your account: ${me.data?.message ?? `HTTP ${me.status}`}`);
  const source = io.env.VALYRO_TOKEN?.trim() ? 'VALYRO_TOKEN' : authFile(io.env);
  io.out(`${me.data.user.login} (${planName(me.data.plan)}), token from ${source}${me.data.token?.name ? ` ("${me.data.token.name}")` : ''}`);
  if (planName(me.data.plan) !== 'ValyroUI Pro') io.out(`Pro components: ${PRICING_URL}`);
  return 0;
}
