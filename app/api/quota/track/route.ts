import { getCookieChannelStore } from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { trackYouTubeQuotaUsage } from '@/lib/youtube';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: { units?: number } | null = null;
  try {
    body = (await req.json()) as { units?: number };
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const units = Math.max(0, Math.ceil(Number(body?.units ?? 0)));
  if (!Number.isFinite(units) || units <= 0) {
    return Response.json({ ok: true, skipped: true });
  }

  try {
    const cookieStore = await getCookieChannelStore();
    await trackYouTubeQuotaUsage(session.accessToken, units, cookieStore);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Failed to track quota usage' }, { status: 502 });
  }
}
