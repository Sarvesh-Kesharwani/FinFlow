import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

async function refreshGoogleAccessToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error ?? 'RefreshAccessTokenError');
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    refreshToken: data.refresh_token ?? refreshToken,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'openid',
            'email',
            'profile',
            // Drive appdata = hidden app folder in user's Drive, perfect for storing preferences
            'https://www.googleapis.com/auth/drive.appdata',
          ].join(' '),
          access_type: 'offline',
          prompt: process.env.GOOGLE_AUTH_PROMPT ?? 'select_account',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // On first sign-in, persist Google tokens into JWT.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token ?? token.refreshToken;
        // account.expires_at is a Unix timestamp in seconds.
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 60 * 60 * 1000;
        token.error = undefined;
        return token;
      }

      // Refresh ~60s before expiry to absorb clock skew.
      const expiresAt = (token.accessTokenExpires as number | undefined) ?? 0;
      if (Date.now() < expiresAt - 60_000) return token;

      const refreshToken = token.refreshToken as string | undefined;
      if (!refreshToken) {
        return { ...token, accessToken: undefined, error: 'NoRefreshToken' };
      }

      try {
        const refreshed = await refreshGoogleAccessToken(refreshToken);
        return {
          ...token,
          accessToken: refreshed.accessToken,
          accessTokenExpires: refreshed.expiresAt,
          refreshToken: refreshed.refreshToken,
          error: undefined,
        };
      } catch {
        return { ...token, accessToken: undefined, error: 'RefreshAccessTokenError' };
      }
    },
    async session({ session, token }) {
      // Expose tokens to server-side session so Drive API can use them.
      session.accessToken = token.accessToken as string | undefined;
      session.error = token.error as string | undefined;
      return session;
    },
  },
});
