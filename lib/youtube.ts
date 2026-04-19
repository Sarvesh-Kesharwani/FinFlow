// Thin YouTube Data API v3 client. Server-only.
// Exposes: getChannels, getLatestVideosForChannel, getMixedFeed, getChannelGroupedFeed.

import 'server-only';
import { cache } from 'react';
import { matchesMediaFilter } from './media';
import { getRequestTime } from './render';
import { rangeToMs, withinRange } from './time';
import type { Channel, ChannelWithVideos, MediaFilter, QuotaSummary, TimeRange, Video } from './types';
import { getWhitelistedChannelIds } from './whitelist';

const API = 'https://www.googleapis.com/youtube/v3';
const MONITORING_API = 'https://monitoring.googleapis.com/v3';
const YOUTUBE_MONITORED_SERVICE = 'youtube.googleapis.com';
export const YOUTUBE_DAILY_QUOTA_LIMIT = 10_000;

interface MonitoringTimeSeriesResponse {
  timeSeries?: Array<{
    metric?: {
      labels?: Record<string, string>;
    };
    points?: Array<{
      interval?: { endTime?: string };
      value?: { int64Value?: string };
    }>;
  }>;
}

type MonitoringTimeSeries = NonNullable<MonitoringTimeSeriesResponse['timeSeries']>[number];

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

interface YTVideoListResp {
  items: Array<{
    id: string;
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string };
  }>;
}

interface ChannelVideosWithQuota {
  videos: Video[];
  playlistCalls: number;
  videoDetailCalls: number;
}

function parseDurationToSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return undefined;

  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 24 * 60 * 60 +
    Number(hours ?? 0) * 60 * 60 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

function isShortByDuration(durationSec: number | undefined): boolean {
  // The Data API does not expose a first-class shorts flag, so duration is our best stable signal.
  return typeof durationSec === 'number' && durationSec <= 180;
}

async function getVideoDetails(videoIds: string[]): Promise<Map<string, { durationSec?: number; viewCount?: number }>> {
  if (videoIds.length === 0) return new Map();

  const data = await yt<YTVideoListResp>(
    'videos',
    {
      part: 'contentDetails,statistics',
      id: videoIds.join(','),
      maxResults: '50',
    },
    600,
  );

  return new Map(
    data.items.map((item) => {
      const durationSec = parseDurationToSeconds(item.contentDetails?.duration);
      const parsedViews = Number(item.statistics?.viewCount);
      return [
        item.id,
        {
          durationSec,
          viewCount: Number.isFinite(parsedViews) ? parsedViews : undefined,
        },
      ];
    }),
  );
}

function buildQuotaSummary(
  dailyLimit: number,
  usedToday: number,
  source: QuotaSummary['source'],
  sourceLabel: string,
  sourceDetail: string | undefined,
  channelCalls: number,
  playlistCalls: number,
  videoDetailCalls: number,
  updatedAt?: string,
): QuotaSummary {
  const refreshCost = channelCalls + playlistCalls + videoDetailCalls;
  const remainingToday = Math.max(0, dailyLimit - usedToday);

  return {
    dailyLimit,
    usedToday,
    remainingToday,
    usedTodayPercent: dailyLimit > 0 ? (usedToday / dailyLimit) * 100 : 0,
    refreshCost,
    source,
    sourceLabel,
    sourceDetail,
    updatedAt,
    channelCalls,
    playlistCalls,
    videoDetailCalls,
  };
}

function latestPointValue(
  series: MonitoringTimeSeries | undefined,
): { value: number; updatedAt?: string } | null {
  if (!series?.points?.length) return null;

  const point = [...series.points].sort((a, b) => {
    const aTime = Date.parse(a.interval?.endTime ?? '');
    const bTime = Date.parse(b.interval?.endTime ?? '');
    return bTime - aTime;
  })[0];
  const rawValue = Number(point.value?.int64Value);
  if (!Number.isFinite(rawValue)) return null;

  return {
    value: rawValue,
    updatedAt: point.interval?.endTime,
  };
}

async function listMonitoringTimeSeries(
  projectId: string,
  accessToken: string,
  filter: string,
  hours = 48,
): Promise<MonitoringTimeSeries[]> {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const qs = new URLSearchParams({
    filter,
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString(),
    view: 'FULL',
    pageSize: '200',
  });

  const res = await fetch(`${MONITORING_API}/projects/${projectId}/timeSeries?${qs.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Monitoring API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as MonitoringTimeSeriesResponse;
  return data.timeSeries ?? [];
}

function getQuotaProjectId(): string | undefined {
  const configured = process.env.YOUTUBE_QUOTA_PROJECT_ID?.trim();
  if (configured) return configured;

  const generic = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (generic) return generic;

  return undefined;
}

async function getExactYouTubeQuotaSummary(
  accessToken: string | undefined,
  channelCalls: number,
  playlistCalls: number,
  videoDetailCalls: number,
): Promise<QuotaSummary | null> {
  const projectId = getQuotaProjectId();
  if (!projectId || !accessToken) return null;

  const limitSeries = await listMonitoringTimeSeries(
    projectId,
    accessToken,
    [
      'metric.type="serviceruntime.googleapis.com/quota/limit"',
      'resource.type="consumer_quota"',
      `resource.labels.service="${YOUTUBE_MONITORED_SERVICE}"`,
    ].join(' AND '),
  );

  const dailyLimit = limitSeries
    .map((series) => {
      const limitName = series.metric?.labels?.limit_name ?? '';
      const quotaMetric = series.metric?.labels?.quota_metric ?? '';
      const latest = latestPointValue(series);
      return {
        limitName,
        quotaMetric,
        value: latest?.value,
        updatedAt: latest?.updatedAt,
      };
    })
    .filter((series) => Number.isFinite(series.value) && /day/i.test(series.limitName))
    .sort((a, b) => {
      const aScore = /queries/i.test(a.limitName) ? 2 : /requests/i.test(a.limitName) ? 1 : 0;
      const bScore = /queries/i.test(b.limitName) ? 2 : /requests/i.test(b.limitName) ? 1 : 0;
      return bScore - aScore;
    })[0];

  if (!dailyLimit?.quotaMetric || typeof dailyLimit.value !== 'number') return null;

  const usageSeries = await listMonitoringTimeSeries(
    projectId,
    accessToken,
    [
      'metric.type="serviceruntime.googleapis.com/quota/allocation/usage"',
      'resource.type="consumer_quota"',
      `resource.labels.service="${YOUTUBE_MONITORED_SERVICE}"`,
      `metric.labels.quota_metric="${dailyLimit.quotaMetric}"`,
    ].join(' AND '),
    26,
  );

  const latestUsage = usageSeries
    .map((series) => latestPointValue(series))
    .filter((point): point is NonNullable<typeof point> => point !== null)
    .sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''))[0];

  return buildQuotaSummary(
    dailyLimit.value,
    latestUsage?.value ?? 0,
    'exact',
    'Google Cloud Monitoring',
    dailyLimit.limitName,
    channelCalls,
    playlistCalls,
    videoDetailCalls,
    latestUsage?.updatedAt ?? dailyLimit.updatedAt,
  );
}

export async function getChannels(ids?: string[]): Promise<Channel[]> {
  if (!ids) ids = await getWhitelistedChannelIds();
  if (ids.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  const all: Channel[] = [];
  for (const c of chunks) {
    const data = await yt<YTChannelListResp>(
      'channels',
      {
        part: 'snippet,contentDetails',
        id: c.join(','),
        maxResults: '50',
      },
      3600,
    );
    for (const it of data.items) {
      all.push({
        id: it.id,
        title: it.snippet.title,
        thumbnail: it.snippet.thumbnails.medium?.url ?? it.snippet.thumbnails.default?.url ?? '',
        uploadsPlaylistId: it.contentDetails.relatedPlaylists.uploads,
      });
    }
  }

  const order = new Map(ids.map((id, i) => [id, i]));
  all.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return all;
}

export function getEstimatedFeedQuotaSummary(
  channelCount: number,
  estimatedPlaylistPagesPerChannel = 2,
): QuotaSummary {
  const channelCalls = channelCount === 0 ? 0 : Math.ceil(channelCount / 50);
  const playlistCalls = channelCount * estimatedPlaylistPagesPerChannel;
  const videoDetailCalls = channelCount * estimatedPlaylistPagesPerChannel;
  const refreshCost = channelCalls + playlistCalls + videoDetailCalls;
  return buildQuotaSummary(
    YOUTUBE_DAILY_QUOTA_LIMIT,
    refreshCost,
    'estimated',
    'Tubeo estimate',
    'Exact quota requires Monitoring scope plus a configured Google Cloud project ID.',
    channelCalls,
    playlistCalls,
    videoDetailCalls,
  );
}

export async function getYouTubeQuotaSummary(
  channelCount: number,
  accessToken?: string,
  estimatedPlaylistPagesPerChannel = 2,
): Promise<QuotaSummary> {
  const estimated = getEstimatedFeedQuotaSummary(channelCount, estimatedPlaylistPagesPerChannel);

  try {
    const exact = await getExactYouTubeQuotaSummary(
      accessToken,
      estimated.channelCalls,
      estimated.playlistCalls,
      estimated.videoDetailCalls,
    );
    return exact ?? estimated;
  } catch (error) {
    return {
      ...estimated,
      sourceDetail: `Fell back to estimate: ${(error as Error).message}`,
    };
  }
}

async function getLatestVideosForChannelWithQuota(
  channel: Channel,
  range: TimeRange,
  mediaFilter: MediaFilter,
  max = 20,
  now = getRequestTime(),
): Promise<ChannelVideosWithQuota> {
  const isAllTime = range === 'all';
  const cutoff = isAllTime ? Number.NEGATIVE_INFINITY : now - rangeToMs(range);
  const out: Video[] = [];
  let pageToken: string | undefined;
  let playlistCalls = 0;
  let videoDetailCalls = 0;
  const maxPages = isAllTime ? 10 : 3;

  for (let page = 0; page < maxPages; page++) {
    playlistCalls += 1;
    const data = await yt<YTPlaylistItemsResp>(
      'playlistItems',
      {
        part: 'snippet,contentDetails',
        playlistId: channel.uploadsPlaylistId,
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      },
      600,
    );

    const videoIds = data.items.map((item) => item.contentDetails.videoId).filter(Boolean);
    const detailsById = await getVideoDetails(videoIds);
    videoDetailCalls += videoIds.length > 0 ? 1 : 0;

    let stop = false;
    for (const it of data.items) {
      const publishedAt = it.contentDetails.videoPublishedAt ?? it.snippet.publishedAt;
      if (!isAllTime && Date.parse(publishedAt) < cutoff) {
        stop = true;
        break;
      }

      const details = detailsById.get(it.contentDetails.videoId);
      const video: Video = {
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
        durationSec: details?.durationSec,
        viewCount: details?.viewCount,
        isShort: isShortByDuration(details?.durationSec),
      };

      if (!matchesMediaFilter(video, mediaFilter)) continue;

      out.push(video);
      if (out.length >= max) {
        stop = true;
        break;
      }
    }

    if (stop || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return {
    videos: out.filter((video) => withinRange(video.publishedAt, range, now)),
    playlistCalls,
    videoDetailCalls,
  };
}

export async function getLatestVideosForChannel(
  channel: Channel,
  range: TimeRange,
  mediaFilter: MediaFilter = 'all',
  max = 20,
  now = getRequestTime(),
): Promise<Video[]> {
  return (await getLatestVideosForChannelWithQuota(channel, range, mediaFilter, max, now)).videos;
}

export const getChannelGroupedFeed = cache(async function getChannelGroupedFeed(
  range: TimeRange,
  mediaFilter: MediaFilter = 'all',
  perChannel = 6,
  now = getRequestTime(),
): Promise<ChannelWithVideos[]> {
  const channels = await getChannels();
  const results = await Promise.all(
    channels.map(async (channel) => ({
      channel,
      videos: await getLatestVideosForChannel(channel, range, mediaFilter, perChannel, now),
    })),
  );
  return results;
});

export const getMixedFeed = cache(async function getMixedFeed(
  range: TimeRange,
  mediaFilter: MediaFilter = 'all',
  perChannel = 10,
  now = getRequestTime(),
): Promise<Video[]> {
  return (await getMixedFeedWithQuota(range, mediaFilter, perChannel, now)).videos;
});

export const getMixedFeedWithQuota = cache(async function getMixedFeedWithQuota(
  range: TimeRange,
  mediaFilter: MediaFilter = 'all',
  perChannel = 10,
  now = getRequestTime(),
): Promise<{ videos: Video[]; quota: QuotaSummary }> {
  const channels = await getChannels();
  const channelCalls = channels.length === 0 ? 0 : Math.ceil(channels.length / 50);
  const results = await Promise.all(
    channels.map(async (channel) => {
      const { videos, playlistCalls, videoDetailCalls } = await getLatestVideosForChannelWithQuota(
        channel,
        range,
        mediaFilter,
        perChannel,
        now,
      );
      return { videos, playlistCalls, videoDetailCalls };
    }),
  );

  const videos = results.flatMap((result) => result.videos);
  videos.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const playlistCalls = results.reduce((sum, result) => sum + result.playlistCalls, 0);
  const videoDetailCalls = results.reduce((sum, result) => sum + result.videoDetailCalls, 0);

  return {
    videos,
    quota: buildQuotaSummary(
      YOUTUBE_DAILY_QUOTA_LIMIT,
      channelCalls + playlistCalls + videoDetailCalls,
      'estimated',
      'Tubeo estimate',
      'Feed responses still use request-cost estimation.',
      channelCalls,
      playlistCalls,
      videoDetailCalls,
    ),
  };
});
