'use client';

import { useEffect } from 'react';

interface Props {
  units: number;
  trackingKey: string;
}

export function QuotaUsageTracker({ units, trackingKey }: Props) {
  useEffect(() => {
    if (units <= 0) return;

    const sessionKey = `tubeo-quota-${trackingKey}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');

    void fetch('/api/quota/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ units }),
    }).catch(() => {
      sessionStorage.removeItem(sessionKey);
    });
  }, [trackingKey, units]);

  return null;
}
