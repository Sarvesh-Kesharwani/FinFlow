// Whitelist source. Merges env var + cookie-persisted channels.

import { getCookieChannelIds } from './channels-cookie';

export function getEnvChannelIds(): string[] {
  const raw = process.env.WHITELIST_CHANNELS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function getWhitelistedChannelIds(): Promise<string[]> {
  const [env, cookie] = await Promise.all([
    Promise.resolve(getEnvChannelIds()),
    getCookieChannelIds(),
  ]);
  // Deduplicate, env IDs first.
  return [...new Set([...env, ...cookie])];
}
