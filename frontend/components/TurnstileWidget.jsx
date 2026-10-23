'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import HairlineLoadingIndicator from '@/components/HairlineLoadingIndicator';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const TURNSTILE_API_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

let turnstileScriptLoadPromise = null;

function ensureTurnstileScriptLoaded() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Turnstile can only run in the browser'));
  }

  if (window.turnstile && typeof window.turnstile.render === 'function') {
    return Promise.resolve();
  }

  if (!turnstileScriptLoadPromise) {
    turnstileScriptLoadPromise = new Promise((resolve, reject) => {
      const existingTurnstileScript = document.querySelector(
        `script[src="${TURNSTILE_API_SCRIPT_URL}"]`
      );
      const turnstileScript = existingTurnstileScript || document.createElement('script');

      if (!existingTurnstileScript) {
        turnstileScript.src = TURNSTILE_API_SCRIPT_URL;
        turnstileScript.async = true;
        turnstileScript.defer = true;
        document.head.appendChild(turnstileScript);
      }

      turnstileScript.addEventListener('load', () => resolve());
      turnstileScript.addEventListener('error', () => {
        turnstileScriptLoadPromise = null;
        reject(new Error('Failed to load the Turnstile script'));
      });
    });
  }

  return turnstileScriptLoadPromise;
}

const TurnstileWidget = forwardRef(function TurnstileWidget(
  { onTokenGenerated, onTokenExpired, onChallengeError, loadingLabel = 'Preparing the security check…' },
  widgetRef
) {
  const widgetContainerRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);
  const [isChallengeWidgetReady, setIsChallengeWidgetReady] = useState(false);
  const onTokenGeneratedRef = useRef(onTokenGenerated);
  const onTokenExpiredRef = useRef(onTokenExpired);
  const onChallengeErrorRef = useRef(onChallengeError);

  useEffect(() => {
    onTokenGeneratedRef.current = onTokenGenerated;
    onTokenExpiredRef.current = onTokenExpired;
    onChallengeErrorRef.current = onChallengeError;
  });

  useImperativeHandle(widgetRef, () => ({
    resetChallengeWidget() {
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
        onTokenGeneratedRef.current?.(null);
      }
    },
  }));

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) {
      return undefined;
    }

    let isWidgetMounted = true;

    ensureTurnstileScriptLoaded()
      .then(() => {
        if (!isWidgetMounted || !widgetContainerRef.current) {
          return;
        }

        const isNarrowViewport = window.matchMedia('(max-width: 23.75rem)').matches;

        turnstileWidgetIdRef.current = window.turnstile.render(widgetContainerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          size: isNarrowViewport ? 'compact' : 'flexible',
          callback: (challengeToken) => onTokenGeneratedRef.current?.(challengeToken),
          'expired-callback': () => {
            onTokenExpiredRef.current?.();
            onTokenGeneratedRef.current?.(null);
          },
          'error-callback': () => onChallengeErrorRef.current?.(),
        });
        setIsChallengeWidgetReady(true);
      })
      .catch(() => onChallengeErrorRef.current?.());

    return () => {
      isWidgetMounted = false;
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      }
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) {
    return null;
  }

  return (
    <>
      {!isChallengeWidgetReady && (
        <p className="loading-status loading-status--compact turnstile-loading" role="status">
          <HairlineLoadingIndicator color="#a34a25" size={10} />
          <span className="loading-status__label">{loadingLabel}</span>
        </p>
      )}
      <div ref={widgetContainerRef} className="turnstile-widget" />
    </>
  );
});

export function isTurnstileEnabled() {
  return Boolean(TURNSTILE_SITE_KEY);
}

export default TurnstileWidget;