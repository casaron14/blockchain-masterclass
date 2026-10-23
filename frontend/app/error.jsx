'use client';

import { useEffect } from 'react';

const pageStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: '48px 24px',
  background: '#F2EDE3',
  color: '#14120E',
  fontFamily: 'Helvetica, Arial, sans-serif',
};

const cardStyle = {
  maxWidth: '560px',
  width: '100%',
  borderTop: '3px solid #A34A25',
  borderBottom: '1px solid #14120E',
  padding: '40px 0',
};

const eyebrowStyle = {
  margin: 0,
  fontSize: '11px',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#A34A25',
};

const headingStyle = {
  margin: '12px 0 8px',
  fontFamily: '"Times New Roman", Times, serif',
  fontSize: 'clamp(2rem, 5vw, 3rem)',
  fontWeight: 400,
  lineHeight: 1.05,
};

const bodyStyle = {
  margin: '0 0 28px',
  fontSize: '15px',
  lineHeight: 1.65,
  color: '#3B352C',
};

const buttonStyle = {
  border: '1px solid #14120E',
  background: '#14120E',
  color: '#F2EDE3',
  padding: '14px 26px',
  fontSize: '12px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

export default function ApplicationErrorBoundary({ error, reset }) {
  useEffect(() => {
    // The digest is the only identifier that ties the browser error to the
    // server log; keep it visible so a support message can quote it.
    console.error('Unhandled application error', error);
  }, [error]);

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <p style={eyebrowStyle}>DienAcademy</p>
        <h1 style={headingStyle}>Something broke on this page.</h1>
        <p style={bodyStyle}>
          The booking system is still running. Retry this page; if it keeps
          failing, contact support and quote the reference below.
        </p>
        {error?.digest ? (
          <p style={{ ...bodyStyle, fontFamily: 'Courier New, monospace', fontSize: '12px' }}>
            Reference: {error.digest}
          </p>
        ) : null}
        <button type="button" style={buttonStyle} onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}
