'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

function currentReturnPath(): string {
  const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return path.startsWith('/') ? path : '/';
}

export function SignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      className="btn-duo-green text-sm disabled:cursor-wait disabled:opacity-70"
      onClick={async () => {
        if (pending) return;
        setPending(true);

        try {
          await fetch('/api/auth/cleanup', { method: 'POST' });
          await signIn('google', { redirectTo: currentReturnPath() });
        } finally {
          setPending(false);
        }
      }}
    >
      <span aria-hidden>{pending ? '...' : '🔐'}</span> {pending ? 'Redirecting...' : 'Sign in'}
    </button>
  );
}
