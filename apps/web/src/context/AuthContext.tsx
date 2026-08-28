import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionUser } from '@nova/shared';
import { ApiError, api } from '../lib/api';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (input: { token: string; name: string; password: string }) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit etre utilise dans AuthProvider.');
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: SessionUser | null }>('/auth/session');
      setUser(data.user);
    } catch (error) {
      // Une session absente ou expiree n'est pas une erreur applicative.
      if (!(error instanceof ApiError)) throw error;
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      isAdmin: user?.role === 'admin',
      login: async (email, password) => {
        const data = await api.post<{ user: SessionUser }>('/auth/login', { email, password });
        setUser(data.user);
        return data.user;
      },
      register: async (input) => {
        const data = await api.post<{ user: SessionUser }>('/auth/register', input);
        setUser(data.user);
        return data.user;
      },
      logout: async () => {
        try {
          await api.post('/auth/logout');
        } finally {
          setUser(null);
        }
      },
      refresh,
    }),
    [user, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
