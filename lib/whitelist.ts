// Whitelist source. Env-driven for MVP; swap for DB later without touching callers.

export function getWhitelistedChannelIds(): string[] {
  const raw = process.env.WHITELIST_CHANNELS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
