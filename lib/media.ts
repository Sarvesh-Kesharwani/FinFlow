import type { MediaFilter, Video } from './types';

export const DEFAULT_MEDIA_FILTER: MediaFilter = 'all';

export const MEDIA_FILTERS: Array<{ value: MediaFilter; label: string }> = [
  { value: 'all', label: 'Shorts + videos' },
  { value: 'videos', label: 'Videos only' },
  { value: 'shorts', label: 'Shorts only' },
];

export function isValidMediaFilter(value: string | undefined | null): value is MediaFilter {
  return value === 'all' || value === 'videos' || value === 'shorts';
}

export function parseMediaFilter(value: string | undefined | null): MediaFilter {
  return isValidMediaFilter(value) ? value : DEFAULT_MEDIA_FILTER;
}

export function matchesMediaFilter(video: Video, filter: MediaFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'shorts') return Boolean(video.isShort);
  return !video.isShort;
}
