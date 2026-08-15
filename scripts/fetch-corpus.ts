/**
 * Corpus fetcher — downloads every manifest document that has a `url` and no
 * local file yet. Idempotent: existing files are skipped unless --force.
 *
 * Usage: pnpm exec tsx scripts/fetch-corpus.ts [--force] [--only <id-substring>]
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = resolve(ROOT, 'seed-corpus');

// Government sites sit behind Cloudflare; a browser UA is required.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

interface ManifestDoc {
  id: string;
  file: string;
  url?: string;
  title: string;
  skip?: boolean;
}

async function main() {
  const force = process.argv.includes('--force');
  const onlyIx = process.argv.indexOf('--only');
  const only = onlyIx > -1 ? process.argv[onlyIx + 1] : null;

  const manifest = (await import(`file://${resolve(CORPUS, 'manifest.json')}`, {
    with: { type: 'json' },
  })) as { default: { documents: ManifestDoc[] } };

  const targets = manifest.default.documents.filter(
    (d) => d.url && !d.skip && (!only || d.id.includes(only)),
  );

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of targets) {
    const dest = resolve(CORPUS, doc.file);
    if (existsSync(dest) && !force) {
      console.log(`  = ${doc.id} (already present, ${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
      skipped++;
      continue;
    }
    process.stdout.write(`  ↓ ${doc.id} … `);
    try {
      const res = await fetch(doc.url!, {
        headers: { 'user-agent': UA, accept: 'application/pdf,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      const buffer = Buffer.from(await res.arrayBuffer());
      // A tiny or HTML response means a block page, not the PDF.
      if (buffer.length < 20_000 || type.includes('text/html')) {
        throw new Error(`suspicious response (${buffer.length} bytes, ${type})`);
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buffer);
      console.log(`${(buffer.length / 1e6).toFixed(1)} MB`);
      downloaded++;
    } catch (err) {
      console.log(`FAILED — ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\ndone: ${downloaded} downloaded, ${skipped} already present, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
