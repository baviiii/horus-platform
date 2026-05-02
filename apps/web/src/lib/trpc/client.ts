'use client';

import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@horus/api';

export const trpc = createTRPCReact<AppRouter>();
