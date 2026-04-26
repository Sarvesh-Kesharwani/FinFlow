import type { FinanceStore } from './finance-types';
import { normalizeFinanceStore } from './finance-store';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const SPACE = 'appDataFolder';
const FILE_NAME = 'finance-manager-state.json';

interface DriveFinanceData extends FinanceStore {
  updatedAt: string;
}

export interface DriveFinanceState extends FinanceStore {
  updatedAt: string;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function ensureDriveOk(res: Response, action: string): Promise<void> {
  if (res.ok) return;

  let details = '';
  try {
    const text = await res.text();
    details = text ? ` ${text.slice(0, 280)}` : '';
  } catch {
    details = '';
  }

  throw new Error(`Google Drive ${action} failed (${res.status} ${res.statusText}).${details}`.trim());
}

async function listFiles(
  accessToken: string,
  query: string,
  fields = 'files(id,name,mimeType,createdTime)',
): Promise<Array<{ id: string; name?: string; mimeType?: string; createdTime?: string }>> {
  const qs = new URLSearchParams({ spaces: SPACE, fields, q: query });
  const res = await fetch(`${DRIVE_API}/files?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await ensureDriveOk(res, 'list request');
  const data = await res.json();
  return data.files ?? [];
}

async function findFile(accessToken: string, name = FILE_NAME, parent = SPACE): Promise<string | null> {
  const query = [`name='${escapeDriveQueryValue(name)}'`, `'${escapeDriveQueryValue(parent)}' in parents`].join(
    ' and ',
  );
  const files = await listFiles(accessToken, query, 'files(id)');
  return files[0]?.id ?? null;
}

async function readFileJson<T>(accessToken: string, fileId: string): Promise<T | null> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  await ensureDriveOk(res, 'read request');
  return res.json() as Promise<T>;
}

async function uploadJsonFile(
  accessToken: string,
  name: string,
  body: string,
  options?: { fileId?: string; parents?: string[] },
): Promise<void> {
  if (options?.fileId) {
    const res = await fetch(`${UPLOAD_API}/files/${options.fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    await ensureDriveOk(res, 'update request');
    return;
  }

  const metadata = JSON.stringify({ name, parents: options?.parents ?? [SPACE] });
  const boundary = 'finance_manager_boundary';
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

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  await ensureDriveOk(res, 'create request');
}

export async function readDriveFinanceStore(accessToken: string): Promise<DriveFinanceState | null> {
  const fileId = await findFile(accessToken);
  if (!fileId) return null;

  const data = await readFileJson<DriveFinanceData>(accessToken, fileId);
  if (!data) return null;

  return {
    ...normalizeFinanceStore(data),
    updatedAt: data.updatedAt ?? new Date(0).toISOString(),
  };
}

export async function writeDriveFinanceStore(accessToken: string, store: FinanceStore): Promise<string> {
  const fileId = await findFile(accessToken);
  const updatedAt = new Date().toISOString();
  const body = JSON.stringify({
    ...normalizeFinanceStore(store),
    updatedAt,
  });
  await uploadJsonFile(accessToken, FILE_NAME, body, { fileId: fileId ?? undefined, parents: [SPACE] });
  return updatedAt;
}
