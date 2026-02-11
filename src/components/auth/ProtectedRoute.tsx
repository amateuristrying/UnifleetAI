import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';

export function ProtectedRoute() {
    const { user, isLoading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (!isLoading && !user) {
            navigate('/login', { state: { from: location }, replace: true });
        }
    }, [user, isLoading, navigate, location]);

    if (isLoading) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-surface-main">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    return user ? <Outlet /> : null;
}
