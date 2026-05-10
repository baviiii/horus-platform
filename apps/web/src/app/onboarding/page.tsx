import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { prisma } from '@horus/db';

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workspace'
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (await prisma.tenant.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/onboarding');

  // Already a member of a tenant? Bounce them in.
  const existing = await prisma.tenantMember.findFirst({
    where: { userId: user.id },
    include: { tenant: true },
  });
  if (existing) redirect(`/_t/${existing.tenant.slug}`);

  // Pull intent from auth metadata (set in /signup form).
  const meta = (user.user_metadata ?? {}) as {
    intended_org_name?: string;
    intended_plan?: string;
  };
  const orgName = meta.intended_org_name?.trim() || (user.email?.split('@')[0] ?? 'workspace');
  const plan = (meta.intended_plan ?? 'free').toUpperCase();
  const allowedPlans = new Set(['FREE', 'STARTER', 'PRO', 'SCALE', 'ENTERPRISE']);
  const planValue = allowedPlans.has(plan) ? plan : 'FREE';

  const slug = await uniqueSlug(slugify(orgName));

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: orgName,
      plan: planValue as 'FREE' | 'STARTER' | 'PRO' | 'SCALE' | 'ENTERPRISE',
      members: {
        create: { userId: user.id, role: 'OWNER' },
      },
    },
  });

  redirect(`/_t/${tenant.slug}`);
}
