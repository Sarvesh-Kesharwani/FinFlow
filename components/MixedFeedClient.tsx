'use client';

import { useState } from 'react';
import { VideoCard } from '@/components/VideoCard';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import type { Video } from '@/lib/types';

export function MixedFeedClient({ videos, now }: { videos: Video[]; now: number }) {
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);

  return (
    <>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} now={now} onOpen={setActiveVideo} />
        ))}
      </div>

      <VideoPlayerModal video={activeVideo} now={now} onClose={() => setActiveVideo(null)} />
    </>
  );
}
