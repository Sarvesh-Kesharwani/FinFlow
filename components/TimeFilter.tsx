'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { TIME_RANGES } from '@/lib/time';
import type { TimeRange } from '@/lib/types';

export function TimeFilter({ active }: { active: TimeRange }) {
  const pathname = usePathname();
  const sp = useSearchParams();

  function hrefFor(r: TimeRange): string {
    const params = new URLSearchParams(sp.toString());
    params.set('range', r);
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TIME_RANGES.map((r) => {
        const isActive = r.value === active;
        return (
          <Link
            key={r.value}
            href={hrefFor(r.value)}
            className={`chip ${isActive ? 'chip-active' : ''}`}
            scroll={false}
          >
            <span aria-hidden>{r.emoji}</span>
            <span>{r.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
