'use client';

import { getItemEmoji } from '@/lib/item-visuals';

export function ItemAvatar({
  title,
  imageUrl,
  size = 'md',
}: {
  title: string;
  imageUrl?: string;
  size?: 'sm' | 'md';
}) {
  const sizeClass = size === 'sm' ? 'h-10 w-10 text-lg' : 'h-12 w-12 text-xl';

  if (imageUrl) {
    return (
      <div className={`overflow-hidden rounded-2xl border-2 border-duored-border bg-white ${sizeClass}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={title} className="h-full w-full object-cover" loading="lazy" draggable={false} />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center rounded-2xl border-2 border-duored-border bg-duored-soft ${sizeClass}`}
      aria-hidden
    >
      {getItemEmoji(title)}
    </div>
  );
}
