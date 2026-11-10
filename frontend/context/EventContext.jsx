'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchEventConfigurationBySlug } from '@/lib/api';
import { buildEventConfigFromPayload, defaultEventConfig } from '@/lib/eventConfig';

const EventContext = createContext({
  eventConfig: defaultEventConfig,
  isLoadingEvent: true,
  eventLoadError: null,
});

export function EventProvider({ slug, children }) {
  const resolvedSlug = slug || defaultEventConfig.slug;
  const [eventConfig, setEventConfig] = useState(defaultEventConfig);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [eventLoadError, setEventLoadError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setIsLoadingEvent(true);
    setEventLoadError(null);

    fetchEventConfigurationBySlug(resolvedSlug)
      .then((eventPayload) => {
        if (!isMounted) return;
        setEventConfig(buildEventConfigFromPayload(eventPayload));
        setIsLoadingEvent(false);
      })
      .catch((error) => {
        if (!isMounted) return;
        setEventConfig(defaultEventConfig);
        setEventLoadError(error.message);
        setIsLoadingEvent(false);
      });

    return () => {
      isMounted = false;
    };
  }, [resolvedSlug]);

  const contextValue = useMemo(
    () => ({ eventConfig, isLoadingEvent, eventLoadError }),
    [eventConfig, isLoadingEvent, eventLoadError]
  );

  return <EventContext.Provider value={contextValue}>{children}</EventContext.Provider>;
}

export function useEvent() {
  return useContext(EventContext);
}
