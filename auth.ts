import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export const { handlers, auth, signIn, signOut } = NextAuth({
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
          access_type: 'offline', // get refresh_token
          prompt: 'consent',       // always show consent to ensure refresh_token is returned
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // On first sign-in, persist Google tokens into JWT
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose tokens to server-side session so Drive API can use them
      session.accessToken = token.accessToken as string | undefined;
      return session;
    },
  },
});
