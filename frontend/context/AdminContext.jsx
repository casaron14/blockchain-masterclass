'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { adminLogin, adminLogout } from '@/lib/api';
import {
  clampAdminSessionTimerDelayMs,
  isAdminTokenExpired,
  registerAdminSessionExpiryHandler,
  resolveAdminTokenRemainingLifetimeMs,
} from '@/lib/adminSessionExpiry';

const ADMIN_TOKEN_STORAGE_KEY = 'masterclass-admin-token';
const ADMIN_USER_STORAGE_KEY = 'masterclass-admin-user';

const AdminContext = createContext({
  adminToken: null,
  adminUser: null,
  isSessionRestoring: true,
  isLoggingOut: false,
  loginWithPassword: () => Promise.reject(new Error('AdminContext not initialised')),
  completeAdminSession: () => {},
  logoutAdminSession: () => {},
});

function removeStoredAdminSession() {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(ADMIN_USER_STORAGE_KEY);
}

function readStoredAdminToken() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
}

function readStoredAdminUser() {
  if (typeof window === 'undefined') {
    return null;
  }
  const rawUser = window.localStorage.getItem(ADMIN_USER_STORAGE_KEY);
  if (!rawUser) {
    return null;
  }
  try {
    return JSON.parse(rawUser);
  } catch {
    return null;
  }
}

export function AdminProvider({ children }) {
  const [adminToken, setAdminToken] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [isSessionRestoring, setIsSessionRestoring] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const storedAdminToken = readStoredAdminToken();

    // A token left in localStorage from a previous visit may already be past
    // its `exp` claim. Restoring it would send one doomed request before the
    // API rejected it, so the session is discarded while the page is loading.
    if (storedAdminToken && isAdminTokenExpired(storedAdminToken)) {
      removeStoredAdminSession();
      setAdminToken(null);
      setAdminUser(null);
    } else {
      setAdminToken(storedAdminToken);
      setAdminUser(readStoredAdminUser());
    }

    setIsSessionRestoring(false);
  }, []);

  const clearAdminSessionLocally = useCallback(() => {
    setAdminToken(null);
    setAdminUser(null);
    removeStoredAdminSession();
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
    setAdminToken(sessionToken);
    setAdminUser(authenticatedUser);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, sessionToken);
      window.localStorage.setItem(ADMIN_USER_STORAGE_KEY, JSON.stringify(authenticatedUser));
    }
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