'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Container, Wordmark } from '@/components/horus';
import { Button } from '@/components/ui/button';

const DEFAULT_SYSTEM = 'Return a JSON object with fields: answer (string), mood (string).';
const DEFAULT_USER = 'In one sentence, explain what Horus does.';

export default function InferPlaygroundPage() {
  const [apiKey, setApiKey] = useState('');
  const [system, setSystem] = useState(DEFAULT_SYSTEM);
  const [userMessage, setUserMessage] = useState(DEFAULT_USER);
  const [model, setModel] = useState<'fast' | 'deep'>('fast');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch('/api/infer', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: 'playground.manual',
          system,
          messages: [{ role: 'user', content: userMessage }],
          model,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : JSON.stringify(body, null, 2));
        return;
      }

      setResponse(JSON.stringify(body, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="bg-paper min-h-screen">
      <header className="border-ink/10 border-b">
        <Container size="wide" className="flex h-16 items-center justify-between">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Wordmark size="sm" />
          </Link>
          <Link
            href="/playground"
            className="text-ink-faded hover:text-ink font-technical text-xs uppercase tracking-widest transition-colors"
          >
            ← Knowledge playground
          </Link>
        </Container>
      </header>

      <Container size="wide" className="py-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-ink mb-2 text-3xl font-semibold tracking-tight">Infer playground</h1>
          <p className="text-ink-faded mb-8 text-sm leading-relaxed">
            Hit <code className="font-technical text-xs">POST /api/infer</code> with a dev API key.
            Mint one with <code className="font-technical text-xs">pnpm db:bootstrap-key</code>{' '}
            after seeding the database.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block">
              <span className="text-ink mb-1.5 block text-sm font-medium">API key</span>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="horus_sk_test_…"
                required
                className="border-ink/15 bg-paper text-ink placeholder:text-ink-faded/60 focus:border-ink/30 w-full rounded-lg border px-3 py-2 text-sm outline-none ring-0"
              />
            </label>

            <label className="block">
              <span className="text-ink mb-1.5 block text-sm font-medium">Model tier</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as 'fast' | 'deep')}
                className="border-ink/15 bg-paper text-ink w-full rounded-lg border px-3 py-2 text-sm outline-none"
              >
                <option value="fast">fast</option>
                <option value="deep">deep</option>
              </select>
            </label>

            <label className="block">
              <span className="text-ink mb-1.5 block text-sm font-medium">System prompt</span>
              <textarea
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                rows={3}
                required
                className="border-ink/15 bg-paper text-ink font-technical w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
              />
            </label>

            <label className="block">
              <span className="text-ink mb-1.5 block text-sm font-medium">User message</span>
              <textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                rows={3}
                required
                className="border-ink/15 bg-paper text-ink w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
              />
            </label>

            <Button type="submit" disabled={loading || !apiKey.trim()}>
              {loading ? 'Running…' : 'Run infer'}
            </Button>
          </form>

          {error && (
            <pre className="border-destructive/30 bg-destructive/5 text-destructive mt-8 overflow-x-auto rounded-lg border p-4 text-xs">
              {error}
            </pre>
          )}

          {response && (
            <pre className="border-ink/10 bg-ink/[0.03] text-ink mt-8 overflow-x-auto rounded-lg border p-4 text-xs">
              {response}
            </pre>
          )}
        </div>
      </Container>
    </main>
  );
}
