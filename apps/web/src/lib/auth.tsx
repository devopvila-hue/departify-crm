import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Me {
  userId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member';
  orgName: string;
  orgSlug: string;
  organizationId: string;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const data = await api.get<Me>('/api/v1/auth/me');
      setMe(data);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await api.post('/api/v1/auth/logout');
    setMe(null);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthState>(() => ({ me, loading, refresh, logout }), [me, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
