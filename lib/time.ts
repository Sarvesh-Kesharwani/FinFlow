import type { TimeRange } from './types';

export const TIME_RANGES: { value: TimeRange; label: string; emoji: string }[] = [
  { value: '1d', label: '24 hours', emoji: '⚡' },
  { value: '3d', label: '3 days', emoji: '🔥' },
  { value: '7d', label: '7 days', emoji: '🌟' },
  { value: '30d', label: '30 days', emoji: '📅' },
  { value: '180d', label: '6 months', emoji: '🗓️' },
  { value: '365d', label: '1 year', emoji: '🧭' },
  { value: 'all', label: 'All time', emoji: '∞' },
];

export const DEFAULT_RANGE: TimeRange = '7d';

export function rangeToMs(range: TimeRange): number {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case '1d':
      return 1 * day;
    case '3d':
      return 3 * day;
    case '7d':
      return 7 * day;
    case '30d':
      return 30 * day;
    case '180d':
      return 180 * day;
    case '365d':
      return 365 * day;
    case 'all':
      return Number.POSITIVE_INFINITY;
  }
}

export function isValidRange(value: string | undefined | null): value is TimeRange {
  return (
    value === '1d' ||
    value === '3d' ||
    value === '7d' ||
    value === '30d' ||
    value === '180d' ||
    value === '365d' ||
    value === 'all'
  );
}

export function parseRange(value: string | undefined | null): TimeRange {
  return isValidRange(value) ? value : DEFAULT_RANGE;
}

export function withinRange(iso: string, range: TimeRange, now = Date.now()): boolean {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return false;
  if (range === 'all') return true;
  return now - timestamp <= rangeToMs(range);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}
