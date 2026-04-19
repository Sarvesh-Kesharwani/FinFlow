'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { MEDIA_FILTERS } from '@/lib/media';
import type { MediaFilter } from '@/lib/types';

export function MediaTypeFilter({ active }: { active: MediaFilter }) {
  const pathname = usePathname();
  const sp = useSearchParams();

  function hrefFor(media: MediaFilter): string {
    const params = new URLSearchParams(sp.toString());
    if (media === 'all') {
      params.delete('media');
    } else {
      params.set('media', media);
    }
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {MEDIA_FILTERS.map((filter) => {
        const isActive = filter.value === active;
        return (
          <Link
            key={filter.value}
            href={hrefFor(filter.value)}
            className={`chip ${isActive ? 'chip-active' : ''}`}
            scroll={false}
          >
            <span>{filter.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
