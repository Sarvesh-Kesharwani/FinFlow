// Core domain types. Keep minimal + extensible.

export type TimeRange = '1d' | '3d' | '7d' | '30d';

export interface Channel {
  id: string;
  title: string;
  thumbnail: string;
  uploadsPlaylistId: string;
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
}

export interface ChannelWithVideos {
  channel: Channel;
  videos: Video[];
}
