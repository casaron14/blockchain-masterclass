'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminBeginTotpSetup,
  adminConfirmTotpSetup,
  adminVerifyTotp,
} from '@/lib/api';
import { useAdmin } from '@/context/AdminContext';
import LoadingButton from '@/components/LoadingButton';
import LoadingStatusLine from '@/components/LoadingStatusLine';
import AdminSessionLoading from '@/components/AdminSessionLoading';
import TurnstileWidget, { isTurnstileEnabled } from '@/components/TurnstileWidget';

function LoginForm({ onLogin, isSubmitting, externalError }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState(null);
  const [turnstileChallengeFailed, setTurnstileChallengeFailed] = useState(false);
  const turnstileWidgetRef = useRef(null);

  function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);

    if (isTurnstileEnabled() && !turnstileToken) {
      setFormError('Please complete the security check to continue.');
      return;
    }

    onLogin(username.trim(), password, turnstileToken).catch((error) => {
      const errorCode = error.responseBody?.error;
      if (errorCode === 'TURNSTILE_VERIFICATION_FAILED') {
        setFormError('The security check could not be verified. Please try again.');
      } else if (errorCode === 'TURNSTILE_VERIFICATION_UNAVAILABLE') {
        setFormError('The security check is temporarily unavailable. Please try again.');
      } else {
        setFormError(error.message || 'Login failed. Please try again.');
      }
      if (isTurnstileEnabled()) {
        turnstileWidgetRef.current?.resetChallengeWidget();
        setTurnstileToken(null);
      }
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <label className="field">
        <span>Username</span>
        <input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </label>
      {(formError || externalError) && (
        <p className="error-banner">{formError || externalError}</p>
      )}
      <TurnstileWidget
        ref={turnstileWidgetRef}
        loadingLabel="Preparing the security check…"
        onTokenGenerated={setTurnstileToken}
        onTokenExpired={() => setTurnstileToken(null)}
        onChallengeError={() => setTurnstileChallengeFailed(true)}
      />
      {turnstileChallengeFailed && (
        <p className="error-banner">The security check is temporarily unavailable. Please try again.</p>
      )}
      <LoadingButton
        type="submit"
        className="btn btn-primary"
        spinnerColor="#f2ede3"
        autoLoading={false}
        loading={isSubmitting}
        loadingLabel="Signing in…"
      >
        Sign in
      </LoadingButton>
    </form>
  );
}

function TotpCodeForm({ headingText, onConfirm, loadingLabel = 'Verifying code…' }) {
  const [totpCode, setTotpCode] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [formError, setFormError] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    setIsConfirming(true);
    onConfirm(totpCode.trim())
      .catch((error) => {
        setFormError(error.message || 'Verification failed. Please try again.');
      })
      .finally(() => setIsConfirming(false));
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h2 className="card__title">{headingText}</h2>

      <label className="field">
        <span>6-digit code</span>
        <input
          type="text"
          inputMode="numeric"
          value={totpCode}
          onChange={(event) => setTotpCode(event.target.value)}
          autoComplete="one-time-code"
          maxLength={8}
        />
      </label>
      {formError && <p className="error-banner">{formError}</p>}
      <LoadingButton
        type="submit"
        className="btn btn-primary"
        spinnerColor="#f2ede3"
        autoLoading={false}
        loading={isConfirming}
        loadingLabel={loadingLabel}
      >
        Verify code
      </LoadingButton>
    </form>
  );
}

export default function AdminLoginPage() {
  const router = useRouter();
  const { loginWithPassword, completeAdminSession, adminToken, isSessionRestoring } = useAdmin();

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isPreparingTotpSetup, setIsPreparingTotpSetup] = useState(false);
  const [temporaryToken, setTemporaryToken] = useState(null);
  const [totpSetupDetails, setTotpSetupDetails] = useState(null);
  const [loginErrorMessage, setLoginErrorMessage] = useState(null);

  useEffect(() => {
    if (!isSessionRestoring && adminToken) {
      router.replace('/admin');
    }
  }, [isSessionRestoring, adminToken, router]);

  async function handlePasswordLogin(username, password, turnstileToken) {
    setIsLoggingIn(true);
    setLoginErrorMessage(null);
    try {
      const loginResult = await loginWithPassword(username, password, turnstileToken);

      // The deployment admin configured through Vercel environment variables
      // signs in with one step unless ADMIN_TOTP_SECRET is set. The API then
      // returns the full token directly; there is no authenticator setup for
      // an operator to complete.
      if (loginResult.token) {
        completeAdminSession(loginResult.token, loginResult.user);
        router.replace('/admin');
        return;
      }

      setTemporaryToken(loginResult.temporaryToken);
      if (loginResult.totpConfigured) {
        return;
      }
      setIsPreparingTotpSetup(true);
      try {
        const setupDetails = await adminBeginTotpSetup(loginResult.temporaryToken);
        setTotpSetupDetails(setupDetails);
      } catch (setupError) {
        setLoginErrorMessage(
          setupError.message || 'Authenticator setup could not be prepared. Please try again.'
        );
        setTemporaryToken(null);
      }
    } finally {
      setIsLoggingIn(false);
      setIsPreparingTotpSetup(false);
    }
  }

  async function handleVerifyTotp(totpCode) {
    const verificationResult = await adminVerifyTotp(temporaryToken, totpCode);
    completeAdminSession(verificationResult.token, verificationResult.user);
    router.replace('/admin');
  }

  async function handleConfirmTotpSetup(totpCode) {
    const confirmationResult = await adminConfirmTotpSetup(temporaryToken, totpCode);
    completeAdminSession(confirmationResult.token, confirmationResult.user);
    router.replace('/admin');
  }

  if (isSessionRestoring) {
    return <AdminSessionLoading statusLabel="Restoring your admin session…" />;
  }

  if (adminToken) {
    return null;
  }

  return (
    <section className="card admin-login-card">
      <h2 className="card__title">Admin sign in</h2>
      <p className="muted">Sign in to manage bookings for the Blockchain Masterclass.</p>

      {!temporaryToken && (
        <LoginForm
          onLogin={handlePasswordLogin}
          isSubmitting={isLoggingIn}
          externalError={loginErrorMessage}
        />
      )}

      {temporaryToken && isPreparingTotpSetup && (
        <LoadingStatusLine label="Preparing authenticator setup…" />
      )}

      {temporaryToken && !isPreparingTotpSetup && !totpSetupDetails && (
        <TotpCodeForm headingText="Enter your authenticator code" onConfirm={handleVerifyTotp} />
      )}

      {temporaryToken && totpSetupDetails && (
        <>
          <div className="deposit-panel">
            <div className="qr-code-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={totpSetupDetails.qrCodeDataUrl}
                alt="QR code for the authenticator app"
                className="qr-code"
              />
            </div>
            <div className="detail-list">
              <p>
                <strong>Secret key:</strong> <code>{totpSetupDetails.secret}</code>
              </p>
              <p className="muted">
                Add this key to Google Authenticator (scan the QR code or type the secret), then
                enter the generated code below to finish setup.
              </p>
            </div>
          </div>
          <TotpCodeForm
            headingText="Confirm your authenticator"
            onConfirm={handleConfirmTotpSetup}
            loadingLabel="Confirming setup…"
          />
        </>
      )}
    </section>
  );
}