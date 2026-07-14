/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  transpilePackages: [
    '@horus/api',
    '@horus/auth',
    '@horus/core',
    '@horus/db',
    '@horus/sdk',
    '@horus/tenancy',
  ],
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  // Workspace packages ship TS source with ESM `.js` specifiers; teach
  // webpack (prod builds) to resolve them the way tsc/turbopack already do.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.blob.core.windows.net' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // microphone=(self) — the playground's push-to-talk voice needs it.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
