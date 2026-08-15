import type { Metadata } from 'next';
import { IncidentsDemoClient } from './incidents-demo-client';

export const metadata: Metadata = {
  title: 'Incident reporting demo',
  description:
    'Describe an incident in plain language and watch Horus draft the NDIS incident form — every field cited to your words, statutory clocks computed, exported as the Word document you actually file.',
};

export default function IncidentsDemoPage() {
  return <IncidentsDemoClient />;
}
