import { DEFAULT_CHANNEL_SPACE } from './types';

const LEGACY_DEFAULT_SPACE_NAMES = new Set(['GENERAL', 'ALL CHANNELS']);

export function normalizeSpaceName(value: string | undefined | null): string {
  const normalized = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return DEFAULT_CHANNEL_SPACE;
  if (LEGACY_DEFAULT_SPACE_NAMES.has(normalized.toUpperCase())) return DEFAULT_CHANNEL_SPACE;
  return normalized;
}
