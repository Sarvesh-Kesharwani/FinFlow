// Server-side session helpers. Import from here, not directly from auth.ts.
import 'server-only';
import { cache } from 'react';
import { auth } from '@/auth';

export const getSession = cache(async () => {
  try {
    return await auth();
  } catch {
    return null;
  }
});

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  return session;
}
