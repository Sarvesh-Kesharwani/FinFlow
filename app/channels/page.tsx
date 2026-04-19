import { Suspense } from 'react';
import { TimeFilter } from '@/components/TimeFilter';
import { ChannelRow } from '@/components/ChannelRow';
import { EmptyState } from '@/components/EmptyState';
import { parseRange } from '@/lib/time';
import { getChannelGroupedFeed } from '@/lib/youtube';
import { getWhitelistedChannelIds } from '@/lib/whitelist';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage({
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
          <span aria-hidden>📺</span> Channels
        </h1>
        <Suspense fallback={null}>
          <TimeFilter active={range} />
        </Suspense>
      </section>

      <Suspense key={range} fallback={<GroupedSkeleton />}>
        <Grouped range={range} />
      </Suspense>
    </div>
  );
}

async function Grouped({ range }: { range: ReturnType<typeof parseRange> }) {
  if ((await getWhitelistedChannelIds()).length === 0) {
    return (
      <EmptyState
        emoji="📭"
        title="No channels whitelisted yet"
        description="Add channel IDs to WHITELIST_CHANNELS in .env.local (comma-separated)."
      />
    );
  }

  let groups;
  try {
    groups = await getChannelGroupedFeed(range);
  } catch (e) {
    return <EmptyState emoji="⚠️" title="Couldn't load channels" description={(e as Error).message} />;
  }

  if (groups.length === 0) {
    return <EmptyState emoji="🌱" title="No channels found" />;
  }

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <ChannelRow key={g.channel.id} data={g} />
      ))}
    </div>
  );
}

function GroupedSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-duo-soft animate-pulse" />
            <div className="h-5 w-48 bg-duo-soft rounded animate-pulse" />
          </div>
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="card w-[300px] shrink-0">
                <div className="aspect-video bg-duo-soft animate-pulse" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-duo-soft rounded animate-pulse" />
                  <div className="h-3 bg-duo-soft rounded w-2/3 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
