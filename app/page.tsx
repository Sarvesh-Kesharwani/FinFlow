import { Suspense } from 'react';
import { TimeFilter } from '@/components/TimeFilter';
import { VideoCard } from '@/components/VideoCard';
import { EmptyState } from '@/components/EmptyState';
import { parseRange } from '@/lib/time';
import { getMixedFeed } from '@/lib/youtube';
import { getWhitelistedChannelIds } from '@/lib/whitelist';

export const dynamic = 'force-dynamic';

export default async function MixedPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const range = parseRange(sp.range);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-extrabold text-duo-ink flex items-center gap-2">
          <span aria-hidden>🎬</span> Mixed feed
        </h1>
        <Suspense fallback={null}>
          <TimeFilter active={range} />
        </Suspense>
      </section>

      <Suspense key={range} fallback={<FeedSkeleton />}>
        <Feed range={range} />
      </Suspense>
    </div>
  );
}

async function Feed({ range }: { range: ReturnType<typeof parseRange> }) {
  if ((await getWhitelistedChannelIds()).length === 0) {
    return (
      <EmptyState
        emoji="📭"
        title="No channels whitelisted yet"
        description="Add channel IDs to WHITELIST_CHANNELS in .env.local (comma-separated)."
      />
    );
  }

  let videos;
  try {
    videos = await getMixedFeed(range);
  } catch (e) {
    return (
      <EmptyState
        emoji="⚠️"
        title="Couldn't load feed"
        description={(e as Error).message}
      />
    );
  }

  if (videos.length === 0) {
    return <EmptyState emoji="🌱" title="Nothing new in this range" description="Try a longer time window." />;
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((v) => (
        <VideoCard key={v.id} video={v} />
      ))}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card">
          <div className="aspect-video bg-duo-soft animate-pulse" />
          <div className="p-3 space-y-2">
            <div className="h-4 bg-duo-soft rounded animate-pulse" />
            <div className="h-3 bg-duo-soft rounded w-2/3 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
