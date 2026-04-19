'use server';

import { revalidatePath } from 'next/cache';
import { getCookieChannelIds, setCookieChannelIds } from '@/lib/channels-cookie';

const API = 'https://www.googleapis.com/youtube/v3';

function apiKey(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY missing');
  return k;
}

// Extract a handle or channel ID from any YouTube channel URL.
function parseInput(raw: string): { type: 'id'; value: string } | { type: 'handle'; value: string } | null {
  const s = raw.trim();
  // Already a bare UC... ID
  if (/^UC[\w-]{22}$/.test(s)) return { type: 'id', value: s };

  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const parts = url.pathname.split('/').filter(Boolean);
    // /channel/UCxxx
    if (parts[0] === 'channel' && parts[1]?.startsWith('UC')) return { type: 'id', value: parts[1] };
    // /@handle or /c/name or /user/name
    const handle = parts[0]?.startsWith('@') ? parts[0] : parts[1]?.startsWith('@') ? parts[1] : parts[0];
    if (handle) return { type: 'handle', value: handle.replace(/^@/, '') };
  } catch {
    // Not a URL — treat as bare handle
    if (s) return { type: 'handle', value: s.replace(/^@/, '') };
  }
  return null;
}

async function resolveToChannelId(raw: string): Promise<string> {
  const parsed = parseInput(raw);
  if (!parsed) throw new Error('Could not parse channel URL or handle');

  if (parsed.type === 'id') return parsed.value;

  // Resolve handle via search API
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

export async function addChannelAction(
  _prev: { error?: string; success?: string },
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const input = (formData.get('url') as string ?? '').trim();
  if (!input) return { error: 'Please enter a channel URL or handle.' };

  let channelId: string;
  try {
    channelId = await resolveToChannelId(input);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const existing = await getCookieChannelIds();
  if (existing.includes(channelId)) return { error: 'Channel already added.' };

  await setCookieChannelIds([...existing, channelId]);
  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/settings');
  return { success: channelId };
}

export async function removeChannelAction(channelId: string): Promise<void> {
  const existing = await getCookieChannelIds();
  await setCookieChannelIds(existing.filter((id) => id !== channelId));
  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/settings');
}
