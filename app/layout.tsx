import type { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import { Suspense } from 'react';
import Link from 'next/link';
import { AuthButton } from '@/components/AuthButton';
import { NavTabs } from '@/components/NavTabs';
import { SyncButton } from '@/components/SyncButton';
import './globals.css';

const nunito = Nunito({ subsets: ['latin'], weight: ['400', '700', '800', '900'], display: 'swap' });

export const metadata: Metadata = {
  title: 'FinFlow',
  description: 'Duolingo-style personal finance manager with Google login and Drive sync.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.className}>
      <body className="min-h-dvh">
        <div className="bg-orbs" aria-hidden />
        <header className="sticky top-0 z-10 border-b-2 border-duored-border/70 bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-xl font-extrabold text-duored-deep">
              <span aria-hidden>🐲</span>
              <span>FinFlow</span>
            </Link>
            <div className="flex items-center gap-3">
              <Suspense fallback={null}>
                <NavTabs />
              </Suspense>
              <SyncButton />
              <Suspense fallback={null}>
                <AuthButton />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
