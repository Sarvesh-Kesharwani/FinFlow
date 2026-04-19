'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addChannelAction } from '@/app/actions';

const initial = {};

export function AddChannelForm() {
  const [state, dispatch, pending] = useActionState(addChannelAction, initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.success && inputRef.current) inputRef.current.value = '';
  }, [state.success]);

  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          name="url"
          type="text"
          placeholder="youtube.com/@handle or channel URL"
          className="flex-1 px-4 py-2 rounded-chonk border-2 border-duo-border bg-white text-duo-ink placeholder:text-duo-ink/40 focus:outline-none focus:border-duo-green font-semibold text-sm"
          disabled={pending}
          required
        />
        <button type="submit" className="btn-duo-green" disabled={pending}>
          {pending ? '...' : 'Add'}
        </button>
      </div>
      {state.error && (
        <p className="text-sm font-bold text-red-500">{state.error}</p>
      )}
      {state.success && (
        <p className="text-sm font-bold text-duo-greenDark">✓ Channel added! ({state.success})</p>
      )}
    </form>
  );
}
