import type { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import { Suspense } from 'react';
import Link from 'next/link';
import { NavTabs } from '@/components/NavTabs';
import { AuthButton } from '@/components/AuthButton';
import { SyncButton } from '@/components/SyncButton';
import './globals.css';

const nunito = Nunito({ subsets: ['latin'], weight: ['400', '700', '800', '900'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Personal YouTube',
  description: 'Curated feed of your favorite channels.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.className}>
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b-2 border-duo-border">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 font-extrabold text-xl text-duo-greenDark">
              <span aria-hidden>🦉</span>
              <span>Tubeo</span>
            </Link>
            <div className="flex items-center gap-3">
              <Suspense fallback={null}>
                <NavTabs />
              </Suspense>
              <SyncButton />
              <Link href="/settings" className="chip text-duo-ink/60 hover:text-duo-ink" title="Manage channels">
                ⚙️
              </Link>
              <Suspense fallback={null}>
                <AuthButton />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
