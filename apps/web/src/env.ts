import { z } from 'zod';

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_API_KEY: z.string().min(1).optional(),
  AZURE_OPENAI_API_VERSION: z.string().optional(),
  AZURE_OPENAI_COMPLETION_MODEL: z.string().optional(),
  AZURE_OPENAI_EMBEDDING_MODEL: z.string().optional(),

  AZURE_SEARCH_ENDPOINT: z.string().url().optional(),
  AZURE_SEARCH_API_KEY: z.string().min(1).optional(),
  AZURE_SEARCH_INDEX_NAME: z.string().min(1).optional(),

  AZURE_STORAGE_CONNECTION_STRING: z.string().min(1).optional(),
  AZURE_COSMOS_ENDPOINT: z.string().url().optional(),
  AZURE_COSMOS_KEY: z.string().min(1).optional(),
  AZURE_COSMOS_DATABASE: z.string().min(1).optional(),
  AZURE_COSMOS_GRAPH: z.string().min(1).optional(),

  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  RESEND_API_KEY: z.string().min(1).optional(),

  SENTRY_DSN: z.string().url().optional(),
  AXIOM_TOKEN: z.string().min(1).optional(),

  HORUS_APEX_DOMAINS: z.string().default('localhost'),
});

const ClientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type ClientEnv = z.infer<typeof ClientEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid server env:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid server env. See logs above.');
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export function getClientEnv(): ClientEnv {
  const parsed = ClientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });
  if (!parsed.success) {
    console.error('Invalid client env:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid client env. See logs above.');
  }
  return parsed.data;
}
