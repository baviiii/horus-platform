'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ErrorShell } from '@/components/horus/error-shell';

export default function TenantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ tenant: string }>();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[horus/tenant]', { tenant: params.tenant, error });
    }
  }, [error, params.tenant]);

  return <ErrorShell scope="tenant" error={error} reset={reset} />;
}
