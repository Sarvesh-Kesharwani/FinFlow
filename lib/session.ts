// Server-side session helpers. Import from here, not directly from auth.ts.
import 'server-only';
import { auth } from '@/auth';

export async function getSession() {
  try {
    return await auth();
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  return session;
}
