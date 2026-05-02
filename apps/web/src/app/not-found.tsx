import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        That tenant or page doesn&rsquo;t exist — or you don&rsquo;t have access.
      </p>
      <Button asChild className="mt-8">
        <Link href="/">Back home</Link>
      </Button>
    </main>
  );
}
