import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authService, type User, type LoginCredentials } from '../services/auth';
import { useOps } from './OpsContext';

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (credentials: LoginCredentials) => Promise<void>;
    logout: () => void;
    checkPermission: (permission: 'admin_only' | 'view_dashboard') => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const { setOps } = useOps();

    useEffect(() => {
        // Initialize auth state
        const initAuth = async () => {
            try {
                await authService.init(); // Ensure default users exist
                const currentUser = authService.getCurrentUser();

                if (currentUser) {
                    setUser(currentUser);
                    // Enforce role-based ops lock on load
                    if (currentUser.role === 'tanzania') setOps('tanzania');
                    if (currentUser.role === 'zambia') setOps('zambia');
                }
            } catch (error) {
                console.error("Auth initialization failed:", error);
            } finally {
                setIsLoading(false);
            }
        };
        initAuth();
    }, []);

    const login = async (credentials: LoginCredentials) => {
        setIsLoading(true);
        try {
            const response = await authService.login(credentials);
            if (response.success && response.user) {
                setUser(response.user);
                // Enforce ops lock on login
                if (response.user.role === 'tanzania') setOps('tanzania');
                if (response.user.role === 'zambia') setOps('zambia');
            } else {
                throw new Error(response.message);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const logout = () => {
        authService.logout();
        setUser(null);
    };

    const checkPermission = (permission: 'admin_only' | 'view_dashboard') => {
        if (!user) return false;
        if (permission === 'admin_only') return user.role === 'admin';
        return true;
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, checkPermission }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
