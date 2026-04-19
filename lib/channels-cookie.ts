import { cookies } from 'next/headers';
import { normalizeSpaceName } from './spaces';
import { DEFAULT_CHANNEL_SPACE, type ChannelPreference, type ChannelPreferenceStore } from './types';

const COOKIE = 'tubeo_channels';
const DRIVE_READY_COOKIE = 'tubeo_drive_ready';
const LOCAL_UPDATED_COOKIE = 'tubeo_channels_updated_at';
const LOCAL_DIRTY_COOKIE = 'tubeo_channels_dirty';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function dedupeSpaces(spaces: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const space of spaces) {
    const normalized = normalizeSpaceName(space);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function dedupePreferences(channels: ChannelPreference[]): ChannelPreference[] {
  const seen = new Set<string>();
  const out: ChannelPreference[] = [];

  for (const channel of channels) {
    if (!channel.id || seen.has(channel.id)) continue;
    seen.add(channel.id);
    out.push({ id: channel.id, space: normalizeSpaceName(channel.space) });
  }

  return out;
}

function normalizeStore(store: ChannelPreferenceStore): ChannelPreferenceStore {
  const channels = dedupePreferences(store.channels);
  const spaces = dedupeSpaces([
    DEFAULT_CHANNEL_SPACE,
    ...store.spaces,
    ...channels.map((channel) => channel.space),
  ]);

  return { channels, spaces };
}

function parseCookieChannelStore(raw: string): ChannelPreferenceStore {
  const value = raw.trim();
  if (!value) {
    return { channels: [], spaces: [DEFAULT_CHANNEL_SPACE] };
  }

  if (!value.startsWith('{') && !value.startsWith('[')) {
    return normalizeStore({
      channels: value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => ({ id, space: DEFAULT_CHANNEL_SPACE })),
      spaces: [DEFAULT_CHANNEL_SPACE],
    });
  }

  try {
    const parsed = JSON.parse(value) as
      | {
          channels?: Array<{ id?: string; space?: string }>;
          spaces?: string[];
        }
      | Array<{ id?: string; space?: string }>
      | null;

    const channels = Array.isArray(parsed) ? parsed : parsed?.channels ?? [];
    const spaces = Array.isArray(parsed) ? [] : parsed?.spaces ?? [];

    return normalizeStore({
      channels: channels
        .map((item) => ({
          id: item?.id?.trim() ?? '',
          space: normalizeSpaceName(item?.space),
        }))
        .filter((item) => item.id),
      spaces,
    });
  } catch {
    return { channels: [], spaces: [DEFAULT_CHANNEL_SPACE] };
  }
}

export async function getCookieChannelStore(): Promise<ChannelPreferenceStore> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value ?? '';
  return parseCookieChannelStore(raw);
}

export async function getCookieChannelPreferences(): Promise<ChannelPreference[]> {
  return (await getCookieChannelStore()).channels;
}

export async function getCookieChannelSpaces(): Promise<string[]> {
  return (await getCookieChannelStore()).spaces;
}

export async function getCookieChannelIds(): Promise<string[]> {
  return (await getCookieChannelPreferences()).map((channel) => channel.id);
}

export async function setCookieChannelIds(ids: string[]): Promise<void> {
  await setCookieChannelPreferences(ids.map((id) => ({ id, space: DEFAULT_CHANNEL_SPACE })));
}

export async function setCookieChannelStore(store: ChannelPreferenceStore): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, JSON.stringify(normalizeStore(store)), {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function hasDriveSyncHydrated(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(DRIVE_READY_COOKIE)?.value === '1';
}

export async function markDriveSyncHydrated(): Promise<void> {
  const jar = await cookies();
  jar.set(DRIVE_READY_COOKIE, '1', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function getCookieChannelSyncMeta(): Promise<{ updatedAt: string | null; dirty: boolean }> {
  const jar = await cookies();
  return {
    updatedAt: jar.get(LOCAL_UPDATED_COOKIE)?.value ?? null,
    dirty: jar.get(LOCAL_DIRTY_COOKIE)?.value === '1',
  };
}

export async function markCookieChannelStoreDirty(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(LOCAL_UPDATED_COOKIE, updatedAt, {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
  jar.set(LOCAL_DIRTY_COOKIE, '1', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function markCookieChannelStoreSynced(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(LOCAL_UPDATED_COOKIE, updatedAt, {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
  jar.set(LOCAL_DIRTY_COOKIE, '0', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function setCookieChannelPreferences(channels: ChannelPreference[]): Promise<void> {
  const existing = await getCookieChannelStore();
  await setCookieChannelStore({ channels, spaces: existing.spaces });
}

export async function setCookieChannelSpaces(spaces: string[]): Promise<void> {
  const existing = await getCookieChannelStore();
  await setCookieChannelStore({ channels: existing.channels, spaces });
}

export async function clearCookieChannelIds(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(DRIVE_READY_COOKIE);
  jar.delete(LOCAL_UPDATED_COOKIE);
  jar.delete(LOCAL_DIRTY_COOKIE);
}
