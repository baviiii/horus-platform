'use client';

import { useEffect } from 'react';
import { ErrorShell } from '@/components/horus/error-shell';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error('[horus/root]', error);
    // TODO: Sentry.captureException(error, { tags: { scope: 'root' } });
  }, [error]);

  return <ErrorShell error={error} reset={reset} scope="root" />;
}
