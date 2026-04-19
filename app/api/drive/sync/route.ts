import { auth } from '@/auth';
import { readDriveChannels, writeDriveChannels } from '@/lib/drive';
import { getCookieChannelIds, setCookieChannelIds } from '@/lib/channels-cookie';
import { getEnvChannelIds } from '@/lib/whitelist';

// GET — read Drive, return { driveIds, cookieIds, synced }
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  const [cookieIds, driveData] = await Promise.all([
    getCookieChannelIds(),
    readDriveChannels(session.accessToken),
  ]);

  const driveIds = driveData?.channelIds ?? [];
  const envIds = getEnvChannelIds();

  // Synced = cookie channels (excluding env) match Drive exactly
  const cookieOnly = cookieIds.filter((id) => !envIds.includes(id));
  const synced =
    cookieOnly.length === driveIds.length &&
    cookieOnly.every((id) => driveIds.includes(id));

  return Response.json({ driveIds, cookieIds, synced, updatedAt: driveData?.updatedAt ?? null });
}

// POST /api/drive/sync — push local cookie channels to Drive (manual sync by user)
export async function POST() {
  const session = await auth();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  const [cookieIds] = await Promise.all([getCookieChannelIds()]);
  const envIds = getEnvChannelIds();
  const cookieOnly = cookieIds.filter((id) => !envIds.includes(id));

  await writeDriveChannels(session.accessToken, cookieOnly);
  return Response.json({ ok: true, channelIds: cookieOnly });
}

// PUT /api/drive/sync — pull Drive channels into cookie (called on login, Drive wins)
export async function PUT() {
  const session = await auth();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  const driveData = await readDriveChannels(session.accessToken);
  if (!driveData) return Response.json({ ok: true, channelIds: [] });

  const envIds = getEnvChannelIds();
  // Drive fully replaces local — Drive is source of truth on login
  await setCookieChannelIds(driveData.channelIds.filter((id) => !envIds.includes(id)));
  return Response.json({ ok: true, channelIds: driveData.channelIds });
}
