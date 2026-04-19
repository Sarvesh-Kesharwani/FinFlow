// Server-side session helpers. Import from here, not directly from auth.ts.
import 'server-only';
import { auth } from '@/auth';

export async function getSession() {
  return auth();
}

export async function requireSession() {
  const session = await auth();
  if (!session) throw new Error('Not authenticated');
  return session;
}
