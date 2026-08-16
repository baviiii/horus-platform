import { PageHeader } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { TemplatesClient } from './templates-client';

export const metadata = { title: 'Incident templates · Horus' };
export const dynamic = 'force-dynamic';

export default async function TemplatesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  await requireTenantMember(slug);

  return (
    <>
      <PageHeader
        eyebrow="Incidents / Templates"
        title="Your forms, absorbed."
        description="Upload the incident form you already use (PDF or Word) and Horus turns it into a typed, editable schema — fields, sections, required flags, and PII marking for de-identified exports."
      />
      <Reveal as="div">
        <TemplatesClient slug={slug} />
      </Reveal>
    </>
  );
}
