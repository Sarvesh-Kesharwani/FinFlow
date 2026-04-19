// Google Drive App Data folder helpers - stores channels.json privately in user's Drive.
// App Data is invisible to the user in Drive UI and only accessible by this app.
import { normalizeSpaceName } from './spaces';
import {
  DEFAULT_CHANNEL_SPACE,
  type DailyQuotaUsage,
  type ChannelPreference,
  type ChannelPreferenceStore,
} from './types';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'tubeo-channels.json';
const BACKUP_FOLDER_NAME = 'tubeo-backups';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SPACE = 'appDataFolder';

export interface DriveChannelData {
  channelIds?: string[];
  channels?: ChannelPreference[];
  spaces?: string[];
  quota?: DailyQuotaUsage;
  updatedAt: string; // ISO
}

export interface DriveSyncState extends ChannelPreferenceStore {
  quota: DailyQuotaUsage;
  updatedAt: string;
}

export interface DriveWriteState extends ChannelPreferenceStore {
  quota?: DailyQuotaUsage | null;
}

const DEFAULT_QUOTA_RESET_TIMEZONE = process.env.YOUTUBE_QUOTA_RESET_TIMEZONE?.trim() || 'Asia/Kolkata';

function dedupeSpaces(spaces: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const space of spaces) {
    const normalized = normalizeSpaceName(space);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function dedupeChannels(channels: ChannelPreference[]): ChannelPreference[] {
  const seen = new Set<string>();
  const out: ChannelPreference[] = [];

  for (const channel of channels) {
    const id = channel.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, space: normalizeSpaceName(channel.space) });
  }

  return out;
}

function safeQuotaDate(now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_QUOTA_RESET_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

export function getQuotaResetTimezone(): string {
  return DEFAULT_QUOTA_RESET_TIMEZONE;
}

export function normalizeQuotaUsage(quota?: DailyQuotaUsage | null, now = new Date()): DailyQuotaUsage {
  const today = safeQuotaDate(now);
  if (!quota || quota.date !== today) {
    return {
      date: today,
      used: 0,
      updatedAt: now.toISOString(),
    };
  }

  return {
    date: today,
    used: Math.max(0, Math.floor(quota.used || 0)),
    updatedAt: quota.updatedAt || now.toISOString(),
  };
}

function normalizeDriveStore(data: DriveChannelData | null): DriveSyncState | null {
  if (!data) return null;

  const channels = Array.isArray(data.channels)
    ? data.channels
    : (data.channelIds ?? []).map((id) => ({ id, space: DEFAULT_CHANNEL_SPACE }));
  const normalizedChannels = dedupeChannels(channels);
  const spaces = dedupeSpaces([
    DEFAULT_CHANNEL_SPACE,
    ...(data.spaces ?? []),
    ...normalizedChannels.map((channel) => channel.space),
  ]);

  return {
    channels: normalizedChannels,
    spaces,
    quota: normalizeQuotaUsage(data.quota),
    updatedAt: data.updatedAt ?? new Date(0).toISOString(),
  };
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listFiles(
  accessToken: string,
  query: string,
  fields = 'files(id,name,mimeType)',
): Promise<Array<{ id: string; name?: string; mimeType?: string }>> {
  const qs = new URLSearchParams({ spaces: SPACE, fields, q: query });
  const res = await fetch(`${DRIVE_API}/files?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.files ?? [];
}

async function findFile(
  accessToken: string,
  name = FILE_NAME,
  parent: string = SPACE,
  mimeType?: string,
): Promise<string | null> {
  const queryParts = [`name='${escapeDriveQueryValue(name)}'`, `'${escapeDriveQueryValue(parent)}' in parents`];
  if (mimeType) queryParts.push(`mimeType='${escapeDriveQueryValue(mimeType)}'`);
  const files = await listFiles(accessToken, queryParts.join(' and '), 'files(id)');
  return files[0]?.id ?? null;
}

async function readFileJson<T>(accessToken: string, fileId: string): Promise<T | null> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

async function readPrimaryDriveData(accessToken: string): Promise<{ id: string; data: DriveChannelData | null } | null> {
  const fileId = await findFile(accessToken);
  if (!fileId) return null;

  return {
    id: fileId,
    data: await readFileJson<DriveChannelData>(accessToken, fileId),
  };
}

async function uploadJsonFile(
  accessToken: string,
  name: string,
  body: string,
  options?: { fileId?: string; parents?: string[] },
): Promise<void> {
  if (options?.fileId) {
    await fetch(`${UPLOAD_API}/files/${options.fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    return;
  }

  const metadata = JSON.stringify({ name, parents: options?.parents ?? [SPACE] });
  const boundary = 'tubeo_boundary';
  const multipart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    body,
    `--${boundary}--`,
  ].join('\r\n');

  await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
}

async function ensureBackupFolder(accessToken: string): Promise<string> {
  const existingId = await findFile(accessToken, BACKUP_FOLDER_NAME, SPACE, FOLDER_MIME_TYPE);
  if (existingId) return existingId;

  const metadata = JSON.stringify({
    name: BACKUP_FOLDER_NAME,
    mimeType: FOLDER_MIME_TYPE,
    parents: [SPACE],
  });
  const res = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: metadata,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to create backup folder: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.id) throw new Error('Drive backup folder ID missing');
  return data.id as string;
}

async function ensureDailyBackup(
  accessToken: string,
  existing: { id: string; data: DriveChannelData | null } | null,
): Promise<void> {
  const previousDate = existing?.data?.quota?.date?.trim();
  const today = safeQuotaDate();
  if (!existing?.data || !previousDate || previousDate === today) return;

  const backupFolderId = await ensureBackupFolder(accessToken);
  const backupFileName = `tubeo-channels-${previousDate}.json`;
  const backupExists = await findFile(accessToken, backupFileName, backupFolderId);
  if (backupExists) return;

  await uploadJsonFile(
    accessToken,
    backupFileName,
    JSON.stringify(existing.data),
    { parents: [backupFolderId] },
  );
}

export async function readDriveChannels(
  accessToken: string,
): Promise<DriveSyncState | null> {
  const existing = await readPrimaryDriveData(accessToken);
  return normalizeDriveStore(existing?.data ?? null);
}

export async function deleteDriveChannels(accessToken: string): Promise<void> {
  const fileId = await findFile(accessToken);
  if (!fileId) return;

  await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function writeDriveChannels(accessToken: string, store: DriveWriteState): Promise<void> {
  const existing = await readPrimaryDriveData(accessToken);
  await ensureDailyBackup(accessToken, existing);

  const normalizedChannels = dedupeChannels(store.channels);
  const normalizedSpaces = dedupeSpaces([
    DEFAULT_CHANNEL_SPACE,
    ...store.spaces,
    ...normalizedChannels.map((channel) => channel.space),
  ]);
  const normalizedQuota = normalizeQuotaUsage(store.quota);
  const body: DriveChannelData = {
    channels: normalizedChannels,
    channelIds: normalizedChannels.map((channel) => channel.id),
    spaces: normalizedSpaces,
    quota: normalizedQuota,
    updatedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(body);
  await uploadJsonFile(accessToken, FILE_NAME, json, { fileId: existing?.id, parents: [SPACE] });
}

export async function recordDriveQuotaUsage(
  accessToken: string,
  units: number,
  fallbackStore: ChannelPreferenceStore = { channels: [], spaces: [DEFAULT_CHANNEL_SPACE] },
): Promise<DailyQuotaUsage> {
  const normalizedUnits = Math.max(0, Math.ceil(units));
  const existing = await readDriveChannels(accessToken);
  const baseStore: ChannelPreferenceStore = existing
    ? { channels: existing.channels, spaces: existing.spaces }
    : fallbackStore;
  const quota = normalizeQuotaUsage(existing?.quota);
  const nextQuota: DailyQuotaUsage = {
    ...quota,
    used: quota.used + normalizedUnits,
    updatedAt: new Date().toISOString(),
  };

  await writeDriveChannels(accessToken, {
    channels: baseStore.channels,
    spaces: baseStore.spaces,
    quota: nextQuota,
  });

  return nextQuota;
}
