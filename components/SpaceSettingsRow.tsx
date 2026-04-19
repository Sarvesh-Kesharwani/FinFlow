'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteChannelSpaceAction, renameChannelSpaceAction } from '@/app/actions';
import { normalizeSpaceName } from '@/lib/spaces';
import { DEFAULT_CHANNEL_SPACE } from '@/lib/types';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

function createDeleteToken(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0].toString(36).toUpperCase().slice(0, 6).padEnd(6, 'X');
}

export function SpaceSettingsRow({ space }: { space: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(space);
  const [error, setError] = useState('');
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteToken, setDeleteToken] = useState('');
  const [deleteDraft, setDeleteDraft] = useState('');
  const isDefaultSpace = space === DEFAULT_CHANNEL_SPACE;
  const normalizedDraft = normalizeSpaceName(draft);
  const isUnchanged = normalizedDraft === space;

  useEffect(() => {
    setDraft(space);
    setError('');
    setIsDeleteOpen(false);
    setDeleteDraft('');
  }, [space]);

  function handleRename() {
    setError('');

    startTransition(() => {
      void renameChannelSpaceAction(space, draft).then((result) => {
        if (result.error) {
          setError(result.error);
          return;
        }

        router.refresh();
        window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
      });
    });
  }

  function openDeleteModal() {
    setError('');
    setDeleteDraft('');
    setDeleteToken(createDeleteToken());
    setIsDeleteOpen(true);
  }

  function handleDelete() {
    setError('');

    startTransition(() => {
      void deleteChannelSpaceAction(space).then((result) => {
        if (result.error) {
          setError(result.error);
          return;
        }

        setIsDeleteOpen(false);
        setDeleteDraft('');
        router.refresh();
        window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
      });
    });
  }

  return (
    <>
      <div className="rounded-chonk border-2 border-duo-border bg-white px-4 py-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={pending || isDefaultSpace}
            className="flex-1 px-4 py-2 rounded-chonk border-2 border-duo-border bg-white text-duo-ink placeholder:text-duo-ink/40 focus:outline-none focus:border-duo-green font-semibold text-sm"
            aria-label={`Rename ${space} space`}
          />
          <button
            type="button"
            onClick={handleRename}
            disabled={pending || isDefaultSpace || isUnchanged}
            className="btn-duo-blue text-xs px-3 py-2"
          >
            {pending ? '...' : 'Rename'}
          </button>
          <button
            type="button"
            onClick={openDeleteModal}
            disabled={pending || isDefaultSpace}
            className="btn-duo-ghost text-xs px-3 py-2 text-red-500 border-red-200 hover:bg-red-50"
          >
            Delete
          </button>
        </div>

        {isDefaultSpace ? (
          <p className="text-xs font-bold text-duo-ink/50">
            {DEFAULT_CHANNEL_SPACE} is the default space for new channels and deleted-space fallbacks.
          </p>
        ) : (
          <p className="text-xs font-bold text-duo-ink/50">
            Renaming updates every channel here. Deleting moves them all back to {DEFAULT_CHANNEL_SPACE}.
          </p>
        )}

        {error && <p className="text-xs font-bold text-red-500">{error}</p>}
      </div>

      {isDeleteOpen && (
        <div
          className="fixed inset-0 z-50 bg-duo-ink/60 backdrop-blur-sm px-4 py-6 sm:px-8"
          role="dialog"
          aria-modal="true"
          aria-label={`Delete ${space} space`}
          onClick={() => setIsDeleteOpen(false)}
        >
          <div
            className="mx-auto w-full max-w-lg rounded-chonk border-2 border-duo-border bg-white p-5 shadow-card space-y-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-red-500">Delete space</p>
              <h3 className="text-xl font-extrabold text-duo-ink">{space}</h3>
              <p className="text-sm text-duo-mute">
                Type <span className="font-black text-duo-ink">{deleteToken}</span> to confirm. Channels in this
                space will move to {DEFAULT_CHANNEL_SPACE}.
              </p>
            </div>

            <input
              value={deleteDraft}
              onChange={(event) => setDeleteDraft(event.target.value.toUpperCase())}
              className="w-full px-4 py-2 rounded-chonk border-2 border-duo-border bg-white text-duo-ink placeholder:text-duo-ink/40 focus:outline-none focus:border-red-300 font-semibold text-sm"
              placeholder="Type the code exactly"
              autoFocus
            />

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setIsDeleteOpen(false)} className="btn-duo-ghost px-3 py-2 text-xs">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending || deleteDraft !== deleteToken}
                className="btn-duo-ghost px-3 py-2 text-xs text-red-500 border-red-200 hover:bg-red-50"
              >
                {pending ? '...' : `Delete ${space}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
