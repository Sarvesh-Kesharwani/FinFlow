'use client';

import { useEffect } from 'react';
import { timeAgo } from '@/lib/time';
import type { Video } from '@/lib/types';

function getEmbedUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
  });

  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

export function VideoPlayerModal({
  video,
  now,
  onClose,
}: {
  video: Video | null;
  now: number;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!video) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, video]);

  if (!video) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-duo-ink/60 backdrop-blur-sm px-4 py-6 sm:px-8"
      role="dialog"
      aria-modal="true"
      aria-label={video.title}
      onClick={onClose}
    >
      <div
        className="mx-auto flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-chonk border-2 border-duo-border bg-white shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b-2 border-duo-border bg-duo-soft px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-greenDark">Now playing</p>
            <h2 suppressHydrationWarning className="truncate text-lg font-extrabold text-duo-ink">
              {video.title}
            </h2>
          </div>

          <button type="button" onClick={onClose} className="btn-duo-ghost px-3 py-2 text-xs">
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-h-0 bg-[#101820] p-3 sm:p-5">
            <div className="overflow-hidden rounded-[28px] border-2 border-duo-border bg-black shadow-card">
              <div className="aspect-video">
                <iframe
                  src={getEmbedUrl(video.id)}
                  title={video.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="h-full w-full"
                />
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col gap-4 border-t-2 border-duo-border bg-white p-4 sm:p-5 lg:border-l-2 lg:border-t-0">
            <div className="rounded-[28px] border-2 border-duo-border bg-duo-soft/80 p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-greenDark">Channel</p>
              <p className="mt-2 text-lg font-extrabold text-duo-ink">{video.channelTitle}</p>
              <p className="mt-2 text-sm font-bold text-duo-mute">{timeAgo(video.publishedAt, now)}</p>
            </div>

            <div className="rounded-[28px] border-2 border-duo-border bg-white p-4 shadow-card">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-greenDark">Popup player</p>
              <p suppressHydrationWarning className="mt-2 text-base font-bold leading-relaxed text-duo-ink">
                {video.title}
              </p>
              <p className="mt-3 text-sm text-duo-mute">
                Playing inside Tubeo so you can keep browsing your dashboard without leaving the page.
              </p>
            </div>

            <div className="mt-auto flex flex-col gap-2">
              <a
                href={`https://www.youtube.com/watch?v=${video.id}`}
                target="_blank"
                rel="noreferrer"
                className="btn-duo-blue w-full"
              >
                Open on YouTube
              </a>
              <button type="button" onClick={onClose} className="btn-duo-ghost w-full">
                Back to feed
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
