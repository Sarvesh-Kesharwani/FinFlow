'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const AUTH_POPUP_COMPLETE = 'finflow-auth-popup-complete';

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}

export function AuthPopupComplete() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const returnTo = safeReturnTo(searchParams.get('returnTo'));
    if (window.opener && window.opener !== window) {
      window.opener.postMessage({ type: AUTH_POPUP_COMPLETE, returnTo }, window.location.origin);
      window.close();
      return;
    }

    window.location.replace(returnTo);
  }, [searchParams]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="chip text-duored-deep">Google sign-in complete</div>
      <p className="text-sm font-bold text-duored-muted">Returning to FinFlow...</p>
    </main>
  );
}
