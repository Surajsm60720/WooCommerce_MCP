import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from '../api/client';
import type { LoginResponse, User } from '../types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setSession: (token: string, user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readInitialSession(): { token: string | null; user: User | null } {
  const token = getStoredToken();
  if (!token) return { token: null, user: null };
  const raw = localStorage.getItem('mcp_gateway_user');
  if (!raw) return { token, user: null };
  try {
    return { token, user: JSON.parse(raw) as User };
  } catch {
    return { token, user: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = readInitialSession();
  const [token, setToken] = useState<string | null>(initial.token);
  const [user, setUser] = useState<User | null>(initial.user);

  const setSession = useCallback((nextToken: string, nextUser: User) => {
    setStoredToken(nextToken);
    localStorage.setItem('mcp_gateway_user', JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<LoginResponse>(
        '/api/auth/login',
        { email, password },
        false,
      );
      setSession(res.token, res.user);
    },
    [setSession],
  );

  const logout = useCallback(() => {
    clearStoredToken();
    localStorage.removeItem('mcp_gateway_user');
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token),
      isAdmin: user?.role === 'admin',
      login,
      logout,
      setSession,
    }),
    [user, token, login, logout, setSession],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
