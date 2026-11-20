'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ADMIN_COOKIE_SESSION_MARKER,
  adminFetchSession,
  adminLogin,
  adminLogout,
} from '@/lib/api';
import {
  clampAdminSessionTimerDelayMs,
  isAdminTokenExpired,
  registerAdminSessionExpiryHandler,
  resolveAdminTokenRemainingLifetimeMs,
} from '@/lib/adminSessionExpiry';

const AdminContext = createContext({
  adminToken: null,
  adminUser: null,
  isSessionRestoring: true,
  isLoggingOut: false,
  loginWithPassword: () => Promise.reject(new Error('AdminContext not initialised')),
  completeAdminSession: () => {},
  logoutAdminSession: () => {},
});

export function AdminProvider({ children }) {
  const [adminToken, setAdminToken] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [isSessionRestoring, setIsSessionRestoring] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // The JWT lives in an httpOnly cookie. The browser only restores the session
  // state from the server, so a script on the page cannot read the credential.
  useEffect(() => {
    let isMounted = true;

    adminFetchSession()
      .then((sessionResult) => {
        if (!isMounted) {
          return;
        }
        setAdminToken(ADMIN_COOKIE_SESSION_MARKER);
        setAdminUser(sessionResult.user ?? null);
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }
        setAdminToken(null);
        setAdminUser(null);
      })
      .finally(() => {
        if (isMounted) {
          setIsSessionRestoring(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const clearAdminSessionLocally = useCallback(() => {
    setAdminToken(null);
    setAdminUser(null);
  }, []);

  // Sign the operator out the moment the token reaches its expiry instead of
  // waiting for the next API call to fail. The timer is re-armed in chunks so a
  // lifetime longer than setTimeout supports still ends in the right place.
  useEffect(() => {
    if (!adminToken) {
      return undefined;
    }

    let activeExpiryTimerId = null;
    let isExpiryTimerCancelled = false;

    const scheduleNextAdminTokenExpiryCheck = () => {
      const remainingLifetimeMs = resolveAdminTokenRemainingLifetimeMs(adminToken);
      if (remainingLifetimeMs === null) {
        return;
      }
      if (remainingLifetimeMs === 0) {
        clearAdminSessionLocally();
        return;
      }

      activeExpiryTimerId = window.setTimeout(() => {
        if (isExpiryTimerCancelled) {
          return;
        }
        if (isAdminTokenExpired(adminToken)) {
          clearAdminSessionLocally();
          return;
        }
        scheduleNextAdminTokenExpiryCheck();
      }, clampAdminSessionTimerDelayMs(remainingLifetimeMs));
    };

    scheduleNextAdminTokenExpiryCheck();

    return () => {
      isExpiryTimerCancelled = true;
      if (activeExpiryTimerId !== null) {
        window.clearTimeout(activeExpiryTimerId);
      }
    };
  }, [adminToken, clearAdminSessionLocally]);

  // A request can still be rejected before the timer fires (clock drift, a
  // revoked token, a sleeping tab). The API layer reports that rejection here
  // so the same local cleanup runs.
  useEffect(
    () => registerAdminSessionExpiryHandler(clearAdminSessionLocally),
    [clearAdminSessionLocally]
  );

  const loginWithPassword = useCallback(async (username, password, turnstileToken) => {
    const loginResult = await adminLogin(username, password, turnstileToken);
    return loginResult;
  }, []);

  const completeAdminSession = useCallback((sessionToken, authenticatedUser) => {
    // The token is already stored by the server in an httpOnly cookie. Keeping
    // only a marker in React state means no script can read the credential.
    setAdminToken(ADMIN_COOKIE_SESSION_MARKER);
    setAdminUser(authenticatedUser);
  }, []);

  const logoutAdminSession = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await adminLogout();
    } catch {
      // The local session is discarded below; remote logout is best-effort.
      // It is expected to fail when the token has already expired.
    }
    clearAdminSessionLocally();
    setIsLoggingOut(false);
  }, [clearAdminSessionLocally]);

  const contextValue = useMemo(
    () => ({
      adminToken,
      adminUser,
      isSessionRestoring,
      isLoggingOut,
      loginWithPassword,
      completeAdminSession,
      logoutAdminSession,
    }),
    [adminToken, adminUser, isSessionRestoring, isLoggingOut, loginWithPassword, completeAdminSession, logoutAdminSession]
  );

  return <AdminContext.Provider value={contextValue}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  return useContext(AdminContext);
}