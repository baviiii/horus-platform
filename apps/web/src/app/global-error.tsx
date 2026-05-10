'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error('[horus/global]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#fafafa',
          color: '#0a0a0a',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
          padding: '120px 24px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        <div style={{ maxWidth: 560, width: '100%' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              color: '#737373',
              marginBottom: 24,
            }}
          >
            Application error
          </div>
          <h1
            style={{
              fontSize: 56,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: '-0.025em',
              margin: 0,
            }}
          >
            Something broke before the page could load.
          </h1>
          <p
            style={{
              marginTop: 24,
              color: '#525252',
              fontSize: 17,
              lineHeight: 1.6,
            }}
          >
            The error has been logged. Try reloading — most issues clear on a second attempt.
          </p>
          {error?.digest && (
            <div
              style={{
                marginTop: 32,
                padding: '14px 18px',
                border: '1px solid #e5e5e5',
                borderRadius: 12,
                background: '#f5f5f5',
                fontFamily: 'ui-monospace, "SF Mono", monospace',
                fontSize: 12,
                color: '#404040',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: '#737373',
                  marginBottom: 6,
                }}
              >
                Reference
              </div>
              {error.digest}
            </div>
          )}
          <div style={{ marginTop: 32, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => reset()}
              style={{
                background: '#0a0a0a',
                color: '#fff',
                border: 0,
                padding: '12px 24px',
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                border: '1px solid #d4d4d4',
                color: '#0a0a0a',
                padding: '12px 24px',
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                background: '#fff',
              }}
            >
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
