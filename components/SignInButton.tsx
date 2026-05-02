'use client';

import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';

const AUTH_POPUP_COMPLETE = 'finflow-auth-popup-complete';

function currentReturnPath(): string {
  const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return path.startsWith('/') ? path : '/';
}

function popupCallbackUrl(): string {
  const url = new URL('/auth/popup-complete', window.location.origin);
  url.searchParams.set('returnTo', currentReturnPath());
  return url.toString();
}

export function SignInButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent<{ type?: string; returnTo?: string }>) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== AUTH_POPUP_COMPLETE) return;

      popupRef.current?.close();
      popupRef.current = null;
      setPending(false);

      const returnTo = event.data.returnTo || currentReturnPath();
      if (returnTo !== currentReturnPath()) {
        window.history.replaceState(null, '', returnTo);
      }
      router.refresh();
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [router]);

  return (
    <button
      type="button"
      disabled={pending}
      className="btn-duo-green text-sm disabled:cursor-wait disabled:opacity-70"
      onClick={async () => {
        if (pending) return;
        setPending(true);
        const popup = window.open('', 'finflow-google-signin', 'width=520,height=720,menubar=no,toolbar=no,location=yes,status=no');
        popupRef.current = popup;

        try {
          await fetch('/api/auth/cleanup', { method: 'POST' });
          const result = await signIn('google', {
            redirect: false,
            redirectTo: popupCallbackUrl(),
          });
          const authUrl = typeof result === 'string' ? result : result?.url;

          if (!authUrl) {
            window.location.assign('/');
            return;
          }

          if (!popup) {
            window.location.assign(authUrl);
            return;
          }

          popup.location.href = authUrl;
          const closedTimer = window.setInterval(() => {
            if (!popup.closed) return;
            window.clearInterval(closedTimer);
            if (popupRef.current === popup) {
              popupRef.current = null;
              setPending(false);
              router.refresh();
            }
          }, 500);
        } finally {
          if (!popup) setPending(false);
        }
      }}
    >
      <span aria-hidden>{pending ? '...' : 'Login'}</span> {pending ? 'Opening...' : 'Sign in'}
    </button>
  );
}
