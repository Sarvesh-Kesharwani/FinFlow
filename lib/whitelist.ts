// Whitelist source. Merges env var + cookie-persisted channels.

import { getCookieChannelPreferences, getCookieChannelSpaces } from './channels-cookie';
import { DEFAULT_CHANNEL_SPACE, type ChannelPreference } from './types';

export function getEnvChannelIds(): string[] {
  const raw = process.env.WHITELIST_CHANNELS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function getWhitelistedChannelPreferences(): Promise<ChannelPreference[]> {
  const [env, cookie] = await Promise.all([
    Promise.resolve(getEnvChannelIds()),
    getCookieChannelPreferences(),
  ]);

  const cookieMap = new Map(cookie.map((channel) => [channel.id, channel.space]));
  const seen = new Set<string>();
  const out: ChannelPreference[] = [];

  for (const id of env) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, space: cookieMap.get(id) ?? DEFAULT_CHANNEL_SPACE });
  }

  for (const channel of cookie) {
    if (seen.has(channel.id)) continue;
    seen.add(channel.id);
    out.push(channel);
  }

  return out;
}

export async function getWhitelistedChannelIds(): Promise<string[]> {
  return (await getWhitelistedChannelPreferences()).map((channel) => channel.id);
}

export async function getWhitelistedChannelSpaces(): Promise<string[]> {
  const [preferences, cookieSpaces] = await Promise.all([
    getWhitelistedChannelPreferences(),
    getCookieChannelSpaces(),
  ]);

  return [...new Set([DEFAULT_CHANNEL_SPACE, ...cookieSpaces, ...preferences.map((channel) => channel.space)])];
}
