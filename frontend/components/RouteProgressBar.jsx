'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { shouldShowNavigationProgressForAnchor } from '@/lib/navigationProgress';

const PROGRESS_SHOW_DELAY_MS = 140;
const PROGRESS_FALLBACK_HIDE_MS = 12000;

export default function RouteProgressBar() {
  const pathname = usePathname();
  const [isRouteChangePending, setIsRouteChangePending] = useState(false);
  const showTimerRef = useRef(null);
  const fallbackHideTimerRef = useRef(null);

  useEffect(() => {
    window.clearTimeout(showTimerRef.current);
    window.clearTimeout(fallbackHideTimerRef.current);
    setIsRouteChangePending(false);
  }, [pathname]);

  useEffect(() => {
    function handleDocumentClick(clickEvent) {
      if (
        clickEvent.button !== 0 ||
        clickEvent.metaKey ||
        clickEvent.ctrlKey ||
        clickEvent.shiftKey ||
        clickEvent.altKey
      ) {
        return;
      }

      const clickedElement = clickEvent.target;
      const anchorElement =
        clickedElement instanceof Element
          ? clickedElement.closest('a[href]')
          : null;

      if (!anchorElement) {
        return;
      }

      if (
        !shouldShowNavigationProgressForAnchor(
          anchorElement,
          window.location.href
        )
      ) {
        return;
      }

      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = window.setTimeout(() => {
        setIsRouteChangePending(true);
        window.clearTimeout(fallbackHideTimerRef.current);
        fallbackHideTimerRef.current = window.setTimeout(() => {
          setIsRouteChangePending(false);
        }, PROGRESS_FALLBACK_HIDE_MS);
      }, PROGRESS_SHOW_DELAY_MS);
    }

    document.addEventListener('click', handleDocumentClick, true);

    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
      window.clearTimeout(showTimerRef.current);
      window.clearTimeout(fallbackHideTimerRef.current);
    };
  }, []);

  return (
    <div
      className={`route-progress${isRouteChangePending ? ' route-progress--active' : ''}`}
      aria-hidden="true"
    >
      <span className="route-progress__bar" />
    </div>
  );
}
