import { NextResponse } from 'next/server';
import { aiProvider } from '@horus/core/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'horus-web',
    version: process.env.npm_package_version ?? 'dev',
    /** Which cloud serves AI right now: azure, aws, or off. */
    ai: aiProvider(),
    timestamp: new Date().toISOString(),
  });
}
