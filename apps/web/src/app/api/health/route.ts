import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'horus-web',
    version: process.env.npm_package_version ?? 'dev',
    timestamp: new Date().toISOString(),
  });
}
