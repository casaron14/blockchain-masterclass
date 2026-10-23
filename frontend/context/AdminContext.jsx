'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { adminLogin, adminLogout } from '@/lib/api';

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
    setAdminToken(readStoredAdminToken());
    setAdminUser(readStoredAdminUser());
    setIsSessionRestoring(false);
  }, []);

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
      // session token is already discarded below; remote logout is best-effort
    }
    setAdminToken(null);
    setAdminUser(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(ADMIN_USER_STORAGE_KEY);
    }
    setIsLoggingOut(false);
  }, []);

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