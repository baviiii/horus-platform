'use client';

import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@horus/api';

export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();
