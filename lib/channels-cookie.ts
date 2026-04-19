import { cookies } from 'next/headers';

const COOKIE = 'tubeo_channels';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export async function getCookieChannelIds(): Promise<string[]> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function setCookieChannelIds(ids: string[]): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, ids.join(','), { maxAge: MAX_AGE, path: '/', sameSite: 'lax' });
}

export async function clearCookieChannelIds(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
