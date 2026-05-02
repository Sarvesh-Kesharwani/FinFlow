import { Suspense } from 'react';
import { AuthPopupComplete } from '@/components/AuthPopupComplete';

export default function AuthPopupCompletePage() {
  return (
    <Suspense fallback={null}>
      <AuthPopupComplete />
    </Suspense>
  );
}
