import Image from 'next/image';
import { VideoCard } from './VideoCard';
import type { ChannelWithVideos } from '@/lib/types';

export function ChannelRow({ data }: { data: ChannelWithVideos }) {
  const { channel, videos } = data;
  return (
    <section className="space-y-3">
      <header className="flex items-center gap-3">
        {channel.thumbnail && (
          <Image
            src={channel.thumbnail}
            alt={channel.title}
            width={48}
            height={48}
            className="rounded-full border-2 border-duo-border"
          />
        )}
        <div className="min-w-0">
          <h2 className="font-bold text-lg text-duo-ink truncate">{channel.title}</h2>
          <p className="text-sm text-duo-mute">
            {videos.length} new {videos.length === 1 ? 'video' : 'videos'}
          </p>
        </div>
      </header>

      {videos.length === 0 ? (
        <div className="card p-6 text-center text-duo-mute">
          No new uploads in this range.
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory -mx-4 px-4">
          {videos.map((v) => (
            <div key={v.id} className="snap-start shrink-0 w-[300px]">
              <VideoCard video={v} showChannel={false} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
