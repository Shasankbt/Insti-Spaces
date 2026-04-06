import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function useRequireAuth() {
    const { user, token, loading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (loading) return;
        if (!user || !token) {
            navigate(
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
