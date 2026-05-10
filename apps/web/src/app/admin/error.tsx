'use client';

import { useEffect } from 'react';
import { ErrorShell } from '@/components/horus/error-shell';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error('[horus/admin]', error);
  }, [error]);

  return <ErrorShell scope="admin" error={error} reset={reset} />;
}
