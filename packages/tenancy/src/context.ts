import type { Tenant } from '@horus/db';

export type TenantSource = 'subdomain' | 'custom-domain' | 'api-key' | 'path' | 'header';

export type ResolvedTenant = {
  tenant: Tenant;
  source: TenantSource;
};
