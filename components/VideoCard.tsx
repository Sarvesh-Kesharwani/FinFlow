import Image from 'next/image';
import { timeAgo } from '@/lib/time';
import type { Video } from '@/lib/types';

export function VideoCard({ video, showChannel = true }: { video: Video; showChannel?: boolean }) {
  const watchUrl = `https://www.youtube.com/watch?v=${video.id}`;
  return (
    <a
      href={watchUrl}
      target="_blank"
      rel="noreferrer"
      className="card block hover:-translate-y-0.5 transition-transform"
    >
      <div className="relative aspect-video bg-duo-soft">
        {video.thumbnail && (
          <Image
            src={video.thumbnail}
            alt={video.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
          />
        )}
      </div>
      <div className="p-3 flex gap-3">
        {showChannel && video.channelThumbnail && (
          <Image
            src={video.channelThumbnail}
            alt={video.channelTitle}
            width={40}
            height={40}
            className="rounded-full border-2 border-duo-border shrink-0"
          />
        )}
        <div className="min-w-0">
          <h3 className="font-bold text-duo-ink line-clamp-2 leading-snug">{video.title}</h3>
          <p className="text-sm text-duo-mute mt-1 truncate">
            {showChannel && <span className="font-semibold text-duo-ink">{video.channelTitle}</span>}
            {showChannel && ' • '}
            <span>{timeAgo(video.publishedAt)}</span>
          </p>
        </div>
      </div>
    </a>
  );
}
