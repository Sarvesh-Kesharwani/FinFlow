// Core domain types. Keep minimal + extensible.

export type TimeRange = '1d' | '3d' | '7d' | '30d' | '180d' | '365d' | 'all';
export type MediaFilter = 'all' | 'videos' | 'shorts';
export const DEFAULT_CHANNEL_SPACE = 'ALL';

export interface Channel {
  id: string;
  title: string;
  thumbnail: string;
  uploadsPlaylistId: string;
}

export interface ChannelPreference {
  id: string;
  space: string;
}

export interface ChannelPreferenceStore {
  channels: ChannelPreference[];
  spaces: string[];
}

export interface Video {
  id: string;
  title: string;
  thumbnail: string;
  publishedAt: string; // ISO
  channelId: string;
  channelTitle: string;
  channelThumbnail?: string;
  durationSec?: number;
  viewCount?: number;
  isShort?: boolean;
}

export interface ChannelWithVideos {
  channel: Channel;
  videos: Video[];
}

export interface QuotaSummary {
  dailyLimit: number;
  estimatedUsed: number;
  estimatedRemaining: number;
  estimatedUsedPercent: number;
  channelCalls: number;
  playlistCalls: number;
  videoDetailCalls: number;
}
