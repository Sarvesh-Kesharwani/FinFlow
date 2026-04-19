'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

export function AddSpaceForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; success?: string }>({});

  useEffect(() => {
    if (!state.success) return;

    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
    window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
  }, [router, state.success]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const space = inputRef.current?.value?.trim() ?? '';
    if (!space) {
      setState({ error: 'Please enter a space name.' });
      return;
    }

    setPending(true);
    setState({});
    try {
      const response = await fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'createSpace', space }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setState({ error: data.error ?? 'Failed to create space.' });
        return;
      }

      setState({ success: String(data.success ?? '') });
    } catch {
      setState({ error: 'Failed to create space.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          name="space"
          type="text"
          placeholder="Create a new space like Tech or Polity"
          className="flex-1 px-4 py-2 rounded-chonk border-2 border-duo-border bg-white text-duo-ink placeholder:text-duo-ink/40 focus:outline-none focus:border-duo-green font-semibold text-sm"
          disabled={pending}
          required
        />
        <button type="submit" className="btn-duo-blue" disabled={pending}>
          {pending ? '...' : 'Create'}
        </button>
      </div>
      {state.error && <p className="text-sm font-bold text-red-500">{state.error}</p>}
      {state.success && <p className="text-sm font-bold text-duo-greenDark">Created space: {state.success}</p>}
    </form>
  );
}
