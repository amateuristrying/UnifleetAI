import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';

export function ProtectedRoute() {
    const { user, isLoading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const searchParams = new URLSearchParams(location.search);
    const isLockedView = location.pathname === '/live-fleet' && searchParams.get('view') === 'locked';

    useEffect(() => {
        if (!isLoading && !user && !isLockedView) {
            navigate('/login', { state: { from: location }, replace: true });
        }
    }, [user, isLoading, navigate, location, isLockedView]);

    if (isLoading && !isLockedView) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-surface-main">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    return (user || isLockedView) ? <Outlet /> : null;
}
