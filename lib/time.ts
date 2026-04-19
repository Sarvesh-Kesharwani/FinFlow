import type { TimeRange } from './types';

export const TIME_RANGES: { value: TimeRange; label: string; emoji: string }[] = [
  { value: '1d',  label: '24 hours', emoji: '⚡' },
  { value: '3d',  label: '3 days',   emoji: '🔥' },
  { value: '7d',  label: '7 days',   emoji: '🌟' },
  { value: '30d', label: '30 days',  emoji: '📅' },
];

export const DEFAULT_RANGE: TimeRange = '7d';

export function rangeToMs(r: TimeRange): number {
  const day = 24 * 60 * 60 * 1000;
  switch (r) {
    case '1d':  return 1  * day;
    case '3d':  return 3  * day;
    case '7d':  return 7  * day;
    case '30d': return 30 * day;
  }
}

export function isValidRange(v: string | undefined | null): v is TimeRange {
  return v === '1d' || v === '3d' || v === '7d' || v === '30d';
}

export function parseRange(v: string | undefined | null): TimeRange {
  return isValidRange(v) ? v : DEFAULT_RANGE;
}

export function withinRange(iso: string, r: TimeRange, now = Date.now()): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return now - t <= rangeToMs(r);
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
  return `${mo}mo ago`;
}
