import type { QuotaSummary } from '@/lib/types';

function formatUnits(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function QuotaCard({ quota }: { quota: QuotaSummary }) {
  const usedWidth = `${Math.min(100, Math.max(0, quota.estimatedUsedPercent))}%`;

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-greenDark">Daily quota</p>
          <h2 className="mt-1 text-2xl font-extrabold text-duo-ink">YouTube Data API budget</h2>
        </div>
        <div className="text-right">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-mute">Remaining</p>
          <p className="mt-1 text-2xl font-extrabold text-duo-greenDark">
            {formatUnits(quota.estimatedRemaining)}
          </p>
          <p className="text-sm font-bold text-duo-mute">of {formatUnits(quota.dailyLimit)}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="h-4 overflow-hidden rounded-full border-2 border-duo-border bg-duo-soft">
          <div className="h-full rounded-full bg-duo-green transition-[width]" style={{ width: usedWidth }} />
        </div>
        <div className="flex items-center justify-between gap-3 text-sm font-bold text-duo-mute">
          <span>{formatUnits(quota.estimatedUsed)} used per typical feed refresh</span>
          <span>{quota.estimatedUsedPercent.toFixed(1)}%</span>
        </div>
      </div>

      <p className="text-sm text-duo-mute">
        Estimated for one feed refresh: {quota.channelCalls} `channels.list` unit
        {quota.channelCalls === 1 ? '' : 's'}, {quota.playlistCalls} `playlistItems.list` unit
        {quota.playlistCalls === 1 ? '' : 's'}, and {quota.videoDetailCalls} `videos.list` unit
        {quota.videoDetailCalls === 1 ? '' : 's'}, assuming about 2 playlist pages per channel.
      </p>
    </section>
  );
}
