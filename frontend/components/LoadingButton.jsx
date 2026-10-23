'use client';

import { useEffect, useRef, useState } from 'react';
import HairlineLoadingIndicator from '@/components/HairlineLoadingIndicator';

const DEFAULT_MIN_LOADING_DURATION_MS = 1200;

export default function LoadingButton({
  children,
  className = '',
  disabled = false,
  loading = false,
  loadingLabel,
  autoLoading = true,
  minLoadingDurationMs = DEFAULT_MIN_LOADING_DURATION_MS,
  onClick,
  spinnerColor = 'currentColor',
  spinnerSize = 16,
  type = 'button',
  ...buttonProps
}) {
  const [isLoadingInternally, setIsLoadingInternally] = useState(false);
  const isActionInFlightRef = useRef(false);
  const releaseTimerRef = useRef(null);
  const isCurrentlyLoading = loading || isLoadingInternally;
  const resolvedClassName = ['loading-button', className].filter(Boolean).join(' ');

  useEffect(
    () => () => {
      window.clearTimeout(releaseTimerRef.current);
    },
    []
  );

  async function handleButtonClick(clickEvent) {
    if (disabled || isCurrentlyLoading || isActionInFlightRef.current) {
      clickEvent.preventDefault();
      return;
    }

    isActionInFlightRef.current = true;

    if (!autoLoading) {
      try {
        await onClick?.(clickEvent);
      } finally {
        isActionInFlightRef.current = false;
      }
      return;
    }

    const clickedAtTimestamp = Date.now();
    setIsLoadingInternally(true);

    try {
      await onClick?.(clickEvent);
    } finally {
      const elapsedMilliseconds = Date.now() - clickedAtTimestamp;
      const remainingHoldMilliseconds = Math.max(
        minLoadingDurationMs - elapsedMilliseconds,
        0
      );
      releaseTimerRef.current = window.setTimeout(() => {
        isActionInFlightRef.current = false;
        setIsLoadingInternally(false);
      }, remainingHoldMilliseconds);
    }
  }

  return (
    <button
      {...buttonProps}
      type={type}
      className={resolvedClassName}
      disabled={disabled || isCurrentlyLoading}
      aria-busy={isCurrentlyLoading || undefined}
      onClick={handleButtonClick}
    >
      {isCurrentlyLoading ? (
        <>
          <HairlineLoadingIndicator color={spinnerColor} size={spinnerSize} />
          <span className="loading-button__label">{loadingLabel || children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
