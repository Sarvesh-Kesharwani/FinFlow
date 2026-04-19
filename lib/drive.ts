// Google Drive App Data folder helpers — stores channels.json privately in user's Drive.
// App Data is invisible to the user in Drive UI and only accessible by this app.

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'tubeo-channels.json';
const SPACE = 'appDataFolder';

export interface DriveChannelData {
  channelIds: string[];
  updatedAt: string; // ISO
}

async function findFile(accessToken: string): Promise<string | null> {
  const qs = new URLSearchParams({ spaces: SPACE, fields: 'files(id)', q: `name='${FILE_NAME}'` });
  const res = await fetch(`${DRIVE_API}/files?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

export async function readDriveChannels(accessToken: string): Promise<DriveChannelData | null> {
  const fileId = await findFile(accessToken);
  if (!fileId) return null;

  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json() as Promise<DriveChannelData>;
}

export async function writeDriveChannels(accessToken: string, channelIds: string[]): Promise<void> {
  const body: DriveChannelData = { channelIds, updatedAt: new Date().toISOString() };
  const json = JSON.stringify(body);
  const existingId = await findFile(accessToken);

  if (existingId) {
    // Update existing file
    await fetch(`${UPLOAD_API}/files/${existingId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: json,
    });
  } else {
    // Create new file in appDataFolder
    const metadata = JSON.stringify({ name: FILE_NAME, parents: [SPACE] });
    const boundary = 'tubeo_boundary';
    const multipart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      json,
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
}
