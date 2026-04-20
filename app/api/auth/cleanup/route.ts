import { cookies } from 'next/headers';

const TRANSIENT_AUTH_COOKIES = [
  'authjs.pkce.code_verifier',
  '__Secure-authjs.pkce.code_verifier',
  'authjs.state',
  '__Secure-authjs.state',
  'authjs.nonce',
  '__Secure-authjs.nonce',
];

export async function POST() {
  const jar = await cookies();

  for (const name of TRANSIENT_AUTH_COOKIES) {
    jar.delete(name);
  }

  return Response.json({ ok: true });
}
