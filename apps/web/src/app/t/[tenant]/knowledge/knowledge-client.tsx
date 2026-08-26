'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/app/shell';

interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  isDefault: boolean;
  docCount: number;
}

const inputCls =
  'border-hairline bg-paper text-ink placeholder:text-ink-mute w-full rounded-xl border px-4 py-2.5 text-[13.5px] focus:border-accent/60 focus:outline-none';

export function KnowledgeClient({ slug, initial }: { slug: string; initial: Collection[] }) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const createMut = trpc.knowledge.create.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setError(e.message),
  });
  const deleteMut = trpc.knowledge.delete.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setError(e.message),
  });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createMut.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
      });
      setName('');
      setDescription('');
      setCategory('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={onCreate}
        className="border-hairline grid gap-3 rounded-xl border p-4 md:grid-cols-[1.2fr_1.6fr_0.8fr_auto]"
      >
        <input
          className={inputCls}
          placeholder="Collection name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className={inputCls}
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          New
        </Button>
      </form>
      {error && <p className="text-destructive text-[12.5px]">{error}</p>}

      {initial.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-ink text-[15px] font-medium">No collections yet.</p>
          <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
            Create your first collection above, then upload documents and assign them. Agents bind
            to collections to stay grounded in a specific slice of the tenant's knowledge.
          </p>
        </div>
      ) : (
        <ul className="divide-hairline -my-2 divide-y">
          {initial.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink truncate text-[14px] font-medium">{c.name}</span>
                  {c.isDefault && <Pill tone="accent">default</Pill>}
                  {c.category && <Pill>{c.category}</Pill>}
                </div>
                <div className="text-ink-faded mt-0.5 text-[12px]">
                  {c.slug} · {c.docCount} {c.docCount === 1 ? 'document' : 'documents'}
                  {c.description && <span className="text-ink-mute"> — {c.description}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/t/${slug}/documents?collection=${c.id}`}
                  className="text-accent text-[12.5px] hover:underline"
                >
                  View documents
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete collection "${c.name}"? Documents stay, but lose their grouping.`,
                      )
                    ) {
                      deleteMut.mutate({ id: c.id });
                    }
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
