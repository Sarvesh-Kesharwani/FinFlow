import { revalidatePath } from 'next/cache';
import {
  getCookieChannelIds,
  getCookieChannelSyncMeta,
  getCookieChannelStore,
  getCookieChannelPreferences,
  hasDriveSyncHydrated,
  markCookieChannelStoreDirty,
  markCookieChannelStoreSynced,
  markDriveSyncHydrated,
  setCookieChannelStore,
  setCookieChannelSpaces,
  setCookieChannelPreferences,
} from '@/lib/channels-cookie';
import { readDriveChannels } from '@/lib/drive';
import { getSession } from '@/lib/session';
import { normalizeSpaceName } from '@/lib/spaces';
import { DEFAULT_CHANNEL_SPACE } from '@/lib/types';
import { getEnvChannelIds } from '@/lib/whitelist';

const API = 'https://www.googleapis.com/youtube/v3';

function apiKey(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY missing');
  return k;
}

async function hydrateCookieStoreFromDriveIfNeeded(): Promise<void> {
  const session = await getSession();
  if (!session?.accessToken) return;
  if (await hasDriveSyncHydrated()) return;

  const driveData = await readDriveChannels(session.accessToken);
  const localMeta = await getCookieChannelSyncMeta();
  if (driveData) {
    const envIds = getEnvChannelIds();
    await setCookieChannelStore({
      channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
      spaces: driveData.spaces,
    });
    await markCookieChannelStoreSynced(driveData.updatedAt);
  } else if (localMeta.updatedAt) {
    await markCookieChannelStoreSynced(localMeta.updatedAt);
  }

  await markDriveSyncHydrated();
}

function parseInput(raw: string): { type: 'id'; value: string } | { type: 'handle'; value: string } | null {
  const s = raw.trim();
  if (/^UC[\w-]{22}$/.test(s)) return { type: 'id', value: s };

  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && parts[1]?.startsWith('UC')) return { type: 'id', value: parts[1] };
    const handle = parts[0]?.startsWith('@') ? parts[0] : parts[1]?.startsWith('@') ? parts[1] : parts[0];
    if (handle) return { type: 'handle', value: handle.replace(/^@/, '') };
  } catch {
    if (s) return { type: 'handle', value: s.replace(/^@/, '') };
  }
  return null;
}

async function resolveToChannelId(raw: string): Promise<string> {
  const parsed = parseInput(raw);
  if (!parsed) throw new Error('Could not parse channel URL or handle');

  if (parsed.type === 'id') return parsed.value;

  const qs = new URLSearchParams({
    part: 'snippet',
    type: 'channel',
    q: parsed.value,
    maxResults: '1',
    key: apiKey(),
  });
  const res = await fetch(`${API}/search?${qs}`);
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
  const data = await res.json();
  const id = data.items?.[0]?.snippet?.channelId;
  if (!id) throw new Error(`Channel not found for "${parsed.value}"`);
  return id;
}

function ok(data: Record<string, unknown>) {
  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/settings');
  return Response.json({ ok: true, ...data });
}

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail('Invalid request body');
  }

  const type = String(body.type ?? '');

  try {
    await hydrateCookieStoreFromDriveIfNeeded();

    if (type === 'addChannel') {
      const input = String(body.url ?? '').trim();
      if (!input) return fail('Please enter a channel URL or handle.');

      const channelId = await resolveToChannelId(input);
      const existing = await getCookieChannelIds();
      if (existing.includes(channelId)) return fail('Channel already added.');

      const channels = await getCookieChannelPreferences();
      await setCookieChannelPreferences([...channels, { id: channelId, space: DEFAULT_CHANNEL_SPACE }]);
      await markCookieChannelStoreDirty();
      return ok({ success: channelId });
    }

    if (type === 'createSpace') {
      const nextSpace = normalizeSpaceName(String(body.space ?? ''));
      const store = await getCookieChannelStore();
      if (store.spaces.includes(nextSpace)) return fail('That space already exists.');

      await setCookieChannelSpaces([...store.spaces, nextSpace]);
      await markCookieChannelStoreDirty();
      return ok({ success: nextSpace });
    }

    if (type === 'removeChannel') {
      const channelId = String(body.channelId ?? '').trim();
      const existing = await getCookieChannelPreferences();
      await setCookieChannelPreferences(existing.filter((channel) => channel.id !== channelId));
      await markCookieChannelStoreDirty();
      return ok({ success: channelId });
    }

    if (type === 'moveChannel') {
      const channelId = String(body.channelId ?? '').trim();
      const nextSpace = normalizeSpaceName(String(body.nextSpace ?? ''));
      const store = await getCookieChannelStore();
      const existing = store.channels;
      const index = existing.findIndex((channel) => channel.id === channelId);

      if (index === -1) {
        await setCookieChannelPreferences([...existing, { id: channelId, space: nextSpace }]);
      } else {
        const updated = [...existing];
        updated[index] = { ...updated[index], space: nextSpace };
        await setCookieChannelPreferences(updated);
      }

      await setCookieChannelSpaces([...store.spaces, nextSpace]);
      await markCookieChannelStoreDirty();
      return ok({ success: nextSpace });
    }

    if (type === 'renameSpace') {
      const existingSpace = normalizeSpaceName(String(body.currentSpace ?? ''));
      const renamedSpace = normalizeSpaceName(String(body.nextSpace ?? ''));
      const store = await getCookieChannelStore();

      if (existingSpace === DEFAULT_CHANNEL_SPACE) {
        return fail(`${DEFAULT_CHANNEL_SPACE} is the default space and cannot be renamed.`);
      }
      if (!store.spaces.includes(existingSpace)) return fail('That space no longer exists.');
      if (existingSpace !== renamedSpace && store.spaces.includes(renamedSpace)) {
        return fail('That space already exists.');
      }

      await setCookieChannelStore({
        channels: store.channels.map((channel) =>
          channel.space === existingSpace ? { ...channel, space: renamedSpace } : channel,
        ),
        spaces: store.spaces.map((space) => (space === existingSpace ? renamedSpace : space)),
      });
      await markCookieChannelStoreDirty();
      return ok({ success: renamedSpace });
    }

    if (type === 'deleteSpace') {
      const targetSpace = normalizeSpaceName(String(body.space ?? ''));
      const store = await getCookieChannelStore();

      if (targetSpace === DEFAULT_CHANNEL_SPACE) {
        return fail(`${DEFAULT_CHANNEL_SPACE} is the default space and cannot be deleted.`);
      }
      if (!store.spaces.includes(targetSpace)) return fail('That space no longer exists.');

      await setCookieChannelStore({
        channels: store.channels.map((channel) =>
          channel.space === targetSpace ? { ...channel, space: DEFAULT_CHANNEL_SPACE } : channel,
        ),
        spaces: store.spaces.filter((space) => space !== targetSpace),
      });
      await markCookieChannelStoreDirty();
      return ok({ success: targetSpace });
    }

    return fail('Unsupported action type');
  } catch (error) {
    return fail((error as Error).message || 'Request failed', 500);
  }
}
