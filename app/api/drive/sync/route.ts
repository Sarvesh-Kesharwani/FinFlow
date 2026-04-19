import { readDriveChannels, writeDriveChannels } from '@/lib/drive';
import {
  getCookieChannelStore,
  hasDriveSyncHydrated,
  markDriveSyncHydrated,
  setCookieChannelStore,
} from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import type { ChannelPreferenceStore } from '@/lib/types';
import { getEnvChannelIds } from '@/lib/whitelist';

// GET - read Drive, return { driveIds, cookieIds, synced }
export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let cookieStore: ChannelPreferenceStore = { channels: [], spaces: [] };
  let driveData = null;
  try {
    [cookieStore, driveData] = await Promise.all([
      getCookieChannelStore(),
      readDriveChannels(session.accessToken),
    ]);
  } catch {
    return Response.json({ error: 'Failed to read Drive sync state' }, { status: 502 });
  }

  const driveChannels = driveData?.channels ?? [];
  const driveSpaces = driveData?.spaces ?? [];
  const envIds = getEnvChannelIds();
  const cookieOnly = cookieStore.channels.filter((channel) => !envIds.includes(channel.id));
  const syncedChannels =
    cookieOnly.length === driveChannels.length &&
    cookieOnly.every((channel, index) =>
      driveChannels[index]?.id === channel.id && driveChannels[index]?.space === channel.space,
    );
  const syncedSpaces =
    cookieStore.spaces.length === driveSpaces.length &&
    cookieStore.spaces.every((space, index) => driveSpaces[index] === space);

  return Response.json({
    driveIds: driveChannels.map((channel) => channel.id),
    cookieIds: cookieStore.channels.map((channel) => channel.id),
    initialized: await hasDriveSyncHydrated(),
    synced: syncedChannels && syncedSpaces,
    updatedAt: driveData?.updatedAt ?? null,
  });
}

// POST /api/drive/sync - push local cookie channels to Drive (manual sync by user)
export async function POST() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let driveData = null;
  const cookieStore = await getCookieChannelStore();
  const envIds = getEnvChannelIds();
  const cookieOnly = cookieStore.channels.filter((channel) => !envIds.includes(channel.id));

  try {
    if (!(await hasDriveSyncHydrated())) {
      driveData = await readDriveChannels(session.accessToken);

      if (driveData) {
        await setCookieChannelStore({
          channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
          spaces: driveData.spaces,
        });
        await markDriveSyncHydrated();
        return Response.json({
          ok: true,
          initialized: true,
          pulledFromDrive: true,
          channelIds: driveData.channels.map((channel) => channel.id),
        });
      }

      await markDriveSyncHydrated();
    }

    driveData = await readDriveChannels(session.accessToken);
    await writeDriveChannels(session.accessToken, {
      channels: cookieOnly,
      spaces: cookieStore.spaces,
      quota: driveData?.quota,
    });
  } catch {
    return Response.json({ error: 'Failed to write Drive sync state' }, { status: 502 });
  }

  return Response.json({ ok: true, channelIds: cookieOnly.map((channel) => channel.id) });
}

// PUT /api/drive/sync - pull Drive channels into cookie (called on login, Drive wins)
export async function PUT() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let driveData = null;
  try {
    driveData = await readDriveChannels(session.accessToken);
  } catch {
    return Response.json({ error: 'Failed to pull channels from Drive' }, { status: 502 });
  }

  if (!driveData) {
    await markDriveSyncHydrated();
    return Response.json({ ok: true, initialized: true, channelIds: [] });
  }

  const envIds = getEnvChannelIds();
  await setCookieChannelStore({
    channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
    spaces: driveData.spaces,
  });
  await markDriveSyncHydrated();
  return Response.json({ ok: true, initialized: true, channelIds: driveData.channels.map((channel) => channel.id) });
}
