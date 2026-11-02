/**
 * The address a reader can open for a knowledge source.
 *
 * An indexed PDF is stored with the source `pdf:<file name>` — fine as an
 * identifier, but no browser opens it, so every "open this document" link
 * built from it was dead. Where a published copy is known (the corpus
 * manifests, plus seed-corpus/public-links.json), this swaps it in. Use it
 * only where a link leaves Horus for a reader; anything that looks a source
 * up again must keep the stored value.
 */
import { PUBLIC_LINKS } from './public-links.generated.js';

export function publicSourceUrl(sourceUrl: string): string {
  if (!sourceUrl.startsWith('pdf:')) return sourceUrl;
  const name = sourceUrl.slice('pdf:'.length).split('/').pop() ?? '';
  return PUBLIC_LINKS[name] ?? sourceUrl;
}
