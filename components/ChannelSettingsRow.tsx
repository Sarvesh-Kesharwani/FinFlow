'use client';

import Image from 'next/image';
import { useTransition } from 'react';
import { removeChannelAction } from '@/app/actions';

interface Props {
  id: string;
  title?: string;
  thumbnail?: string;
  fromEnv: boolean;
}

export function ChannelSettingsRow({ id, title, thumbnail, fromEnv }: Props) {
  const [pending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(() => removeChannelAction(id));
  }

  return (
    <li className="card flex items-center gap-3 px-4 py-3">
      {thumbnail ? (
        <Image src={thumbnail} alt="" width={36} height={36} className="rounded-full shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-duo-soft shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-duo-ink truncate">{title ?? id}</p>
        {title && <p className="text-xs text-duo-ink/50 font-mono truncate">{id}</p>}
      </div>
      {fromEnv ? (
        <span className="text-xs font-bold text-duo-ink/40 uppercase tracking-wide">env</span>
      ) : (
        <button
          onClick={handleRemove}
          disabled={pending}
          className="btn-duo-ghost text-xs px-3 py-1.5 text-red-500 border-red-200 hover:bg-red-50"
        >
          {pending ? '...' : 'Remove'}
        </button>
      )}
    </li>
  );
}
