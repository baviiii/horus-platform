# @horus/sdk

Type-safe client for the [Horus Intelligence Platform](https://horus.ai).

## Install

```bash
pnpm add @horus/sdk
```

## Usage

```ts
import { createHorusClient } from '@horus/sdk';

const horus = createHorusClient({
  apiKey: process.env.HORUS_API_KEY!,
});

// Hybrid RAG query — fully typed inputs and outputs
const result = await horus.rag.query.mutate({
  query: 'What funding programs support renewable energy in South Australia?',
  filters: { sector: 'energy', region: 'sa' },
  options: { maxSources: 10 },
});

console.log(result.answer);
console.log(result.sources);
```

## React

```tsx
import { horusReact } from '@horus/sdk/react';

function Dashboard() {
  const stats = horusReact.rag.metadata.useQuery({ operation: 'stats' });
  return <pre>{JSON.stringify(stats.data, null, 2)}</pre>;
}
```

See the full API reference at [docs.horus.ai](https://docs.horus.ai).
