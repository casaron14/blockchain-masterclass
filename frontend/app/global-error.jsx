'use client';

import { useEffect } from 'react';

// global-error replaces the root layout, so it has to render <html> and <body>
// itself and cannot rely on any provider or global stylesheet.
export default function GlobalApplicationError({ error, reset }) {
  useEffect(() => {
    console.error('Unhandled root layout error', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '48px 24px',
          background: '#F2EDE3',
          color: '#14120E',
          fontFamily: 'Helvetica, Arial, sans-serif',
        }}
      >
        <main style={{ maxWidth: '560px', borderTop: '3px solid #A34A25', paddingTop: '32px' }}>
          <p
            style={{
              margin: 0,
              fontSize: '11px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#A34A25',
            }}
          >
            DienAcademy
          </p>
          <h1
            style={{
              margin: '12px 0 8px',
              fontFamily: '"Times New Roman", Times, serif',
              fontSize: '2.5rem',
              fontWeight: 400,
              lineHeight: 1.05,
            }}
          >
            The site could not load.
          </h1>
          <p style={{ margin: '0 0 28px', fontSize: '15px', lineHeight: 1.65, color: '#3B352C' }}>
            Reload the page to try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: '1px solid #14120E',
              background: '#14120E',
              color: '#F2EDE3',
              padding: '14px 26px',
              fontSize: '12px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
