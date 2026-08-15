'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Workspace PDF upload → the same crawl→chunk→embed→index pipeline the
 * playground runs, pointed at this tenant's permanent partition.
 */
export function UploadDocumentsButton({ slug }: { slug: string }) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set('tenant', slug);
    body.set('file', file);
    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Upload failed');
      } else {
        router.refresh();
      }
    } catch {
      setError('Upload failed — check your connection');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-destructive max-w-xs truncate text-[12.5px]">{error}</span>}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
          e.target.value = '';
        }}
      />
      <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {busy ? 'Indexing…' : 'Upload PDF'}
      </Button>
    </div>
  );
}
