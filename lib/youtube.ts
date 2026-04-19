// Thin YouTube Data API v3 client. Server-only.
// Exposes: getChannels, getLatestVideosForChannel, getMixedFeed, getChannelGroupedFeed.

import 'server-only';
import { cache } from 'react';
import type { Channel, ChannelWithVideos, TimeRange, Video } from './types';
import { getRequestTime } from './render';
import { rangeToMs, withinRange } from './time';
import { getWhitelistedChannelIds } from './whitelist';

const API = 'https://www.googleapis.com/youtube/v3';

function key(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY missing');
  return k;
}

// Fetch wrapper w/ Next revalidation. 10min default; overridable.
async function yt<T>(path: string, params: Record<string, string>, revalidate = 600): Promise<T> {
  const qs = new URLSearchParams({ ...params, key: key() }).toString();
  const res = await fetch(`${API}/${path}?${qs}`, { next: { revalidate } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// --- Channel meta ---

interface YTChannelListResp {
  items: Array<{
    id: string;
    snippet: { title: string; thumbnails: { default?: { url: string }; medium?: { url: string } } };
    contentDetails: { relatedPlaylists: { uploads: string } };
  }>;
}

export async function getChannels(ids?: string[]): Promise<Channel[]> {
  if (!ids) ids = await getWhitelistedChannelIds();
  if (ids.length === 0) return [];
  // API accepts up to 50 ids per call.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  const all: Channel[] = [];
  for (const c of chunks) {
    const data = await yt<YTChannelListResp>('channels', {
      part: 'snippet,contentDetails',
      id: c.join(','),
      maxResults: '50',
    }, 3600);
    for (const it of data.items) {
      all.push({
        id: it.id,
        title: it.snippet.title,
        thumbnail: it.snippet.thumbnails.medium?.url ?? it.snippet.thumbnails.default?.url ?? '',
        uploadsPlaylistId: it.contentDetails.relatedPlaylists.uploads,
      });
    }
  }
  // Preserve whitelist order.
  const order = new Map(ids.map((id, i) => [id, i]));
  all.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return all;
}

// --- Uploads playlist → recent videos ---

interface YTPlaylistItemsResp {
  items: Array<{
    contentDetails: { videoId: string; videoPublishedAt?: string };
    snippet: {
      title: string;
      publishedAt: string;
      channelId: string;
      channelTitle: string;
      thumbnails: { medium?: { url: string }; high?: { url: string }; default?: { url: string } };
    };
  }>;
  nextPageToken?: string;
}

export async function getLatestVideosForChannel(
  channel: Channel,
  range: TimeRange,
  max = 20,
  now = getRequestTime(),
): Promise<Video[]> {
  const cutoff = now - rangeToMs(range);
  const out: Video[] = [];
  let pageToken: string | undefined;
  // Cap pages to avoid quota blowups on big channels.
  for (let page = 0; page < 3; page++) {
    const data = await yt<YTPlaylistItemsResp>('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: channel.uploadsPlaylistId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    }, 600);

    let stop = false;
    for (const it of data.items) {
      const publishedAt = it.contentDetails.videoPublishedAt ?? it.snippet.publishedAt;
      if (Date.parse(publishedAt) < cutoff) { stop = true; break; }
      out.push({
        id: it.contentDetails.videoId,
        title: it.snippet.title,
        thumbnail:
          it.snippet.thumbnails.high?.url ??
          it.snippet.thumbnails.medium?.url ??
          it.snippet.thumbnails.default?.url ??
          '',
        publishedAt,
        channelId: it.snippet.channelId,
        channelTitle: it.snippet.channelTitle,
        channelThumbnail: channel.thumbnail,
      });
      if (out.length >= max) { stop = true; break; }
    }
    if (stop || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out.filter((v) => withinRange(v.publishedAt, range, now));
}

// --- Aggregate views ---

export const getChannelGroupedFeed = cache(async function getChannelGroupedFeed(
  range: TimeRange,
  perChannel = 6,
  now = getRequestTime(),
): Promise<ChannelWithVideos[]> {
  const channels = await getChannels();
  const results = await Promise.all(
    channels.map(async (ch) => ({
      channel: ch,
      videos: await getLatestVideosForChannel(ch, range, perChannel, now),
    })),
  );
  return results;
});

export const getMixedFeed = cache(async function getMixedFeed(
  range: TimeRange,
  perChannel = 10,
  now = getRequestTime(),
): Promise<Video[]> {
  const grouped = await getChannelGroupedFeed(range, perChannel, now);
  const all = grouped.flatMap((g) => g.videos);
  all.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return all;
});
