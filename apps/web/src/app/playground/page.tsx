import type { Metadata } from 'next';
import { PlaygroundClient } from './playground-client';

export const metadata: Metadata = {
  title: 'Playground',
  description:
    'Point Horus at a website or a PDF and talk to it — streaming chat or voice, with every answer grounded in your sources and cited.',
};

export default function PlaygroundPage() {
  return <PlaygroundClient />;
}
