import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { AuthUser } from '../types';

interface UseRequireAuthResult {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
}

export default function useRequireAuth(): UseRequireAuthResult {
  const { user, token, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      void navigate(
        `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`,
        { replace: true },
      );
    }
  }, [user, token, loading, navigate, location.pathname, location.search]);

  return {
    user,
    token,
    loading,
    isAuthenticated: Boolean(user && token),
  };
}
