'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchEventConfigurationBySlug,
  fetchPublicEventList,
} from '@/lib/api';
import { buildEventConfigFromPayload, defaultEventConfig } from '@/lib/eventConfig';

const EventContext = createContext({
  eventConfig: defaultEventConfig,
  isLoadingEvent: true,
  eventLoadError: null,
  applyEventConfigurationSnapshot: () => {},
});

async function resolveRequestedEventConfiguration(eventSlug) {
  if (eventSlug) {
    const eventPayload = await fetchEventConfigurationBySlug(eventSlug);
    return { eventSlug, eventPayload };
  }

  const publicEventList = await fetchPublicEventList();
  const resolvedEventSlug =
    publicEventList.defaultEventSlug || defaultEventConfig.slug;
  const listedEvent = publicEventList.events?.find(
    (eventRecord) => eventRecord.slug === resolvedEventSlug
  );

  if (listedEvent?.configuration) {
    return {
      eventSlug: resolvedEventSlug,
      eventPayload: {
        ...listedEvent.configuration,
        lifecycleStatus: listedEvent.status,
      },
    };
  }

  const eventPayload = await fetchEventConfigurationBySlug(resolvedEventSlug);
  return { eventSlug: resolvedEventSlug, eventPayload };
}

export function EventProvider({ slug, children }) {
  const [eventConfig, setEventConfig] = useState(defaultEventConfig);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [eventLoadError, setEventLoadError] = useState(null);
  const hasSnapshotOverrideRef = useRef(false);

  const applyEventConfigurationSnapshot = useCallback((eventSnapshot) => {
    if (!eventSnapshot || typeof eventSnapshot !== 'object') {
      return;
    }
    hasSnapshotOverrideRef.current = true;
    setEventConfig(buildEventConfigFromPayload(eventSnapshot));
  }, []);

  useEffect(() => {
    let isMounted = true;
    hasSnapshotOverrideRef.current = false;
    setIsLoadingEvent(true);
    setEventLoadError(null);

    resolveRequestedEventConfiguration(slug)
      .then(({ eventPayload }) => {
        if (!isMounted) return;
        if (!hasSnapshotOverrideRef.current) {
          setEventConfig(buildEventConfigFromPayload(eventPayload));
        }
        setIsLoadingEvent(false);
      })
      .catch((error) => {
        if (!isMounted) return;
        if (!hasSnapshotOverrideRef.current) {
          setEventConfig(defaultEventConfig);
        }
        setEventLoadError(error.message);
        setIsLoadingEvent(false);
      });

    return () => {
      isMounted = false;
    };
  }, [slug]);

  const contextValue = useMemo(
    () => ({
      eventConfig,
      isLoadingEvent,
      eventLoadError,
      applyEventConfigurationSnapshot,
    }),
    [eventConfig, isLoadingEvent, eventLoadError, applyEventConfigurationSnapshot]
  );

  return <EventContext.Provider value={contextValue}>{children}</EventContext.Provider>;
}

export function useEvent() {
  return useContext(EventContext);
}
