const USERS_KEY = 'unifleet_users_v2';
// SESSION_KEY removed as we don't persist sessions anymore

export type Role = 'admin' | 'tanzania' | 'zambia';

export interface User {
    username: string;
    role: Role;
}

export interface LoginCredentials {
    username: string;
    password: string;
}

export interface AuthResponse {
    success: boolean;
    user?: User;
    message?: string;
}

// Simple hash function for client-side demo (SHA-256)
async function hashPassword(password: string): Promise<string> {
    try {
        if (window.crypto && window.crypto.subtle) {
            const msgBuffer = new TextEncoder().encode(password);
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) {
        console.warn("Crypto API unavailable, falling back to simple hash", e);
    }
    // Fallback for non-secure contexts (simple base64 of string to simulate hash)
    return btoa(password);
}

const DEFAULT_USERS = [
    { username: 'admin', password: '1901', role: 'admin' },
    { username: 'tanzania', password: '1902', role: 'tanzania' },
    { username: 'zambia', password: '1903', role: 'zambia' },
];

export const authService = {
    async init() {
        const storedUsers = localStorage.getItem(USERS_KEY);
        if (!storedUsers) {
            // Bootstrap default users with hashed passwords
            const initializedUsers = await Promise.all(
                DEFAULT_USERS.map(async (u) => ({
                    ...u,
                    password: await hashPassword(u.password)
                }))
            );
            localStorage.setItem(USERS_KEY, JSON.stringify(initializedUsers));
        }
    },

    async login(credentials: LoginCredentials): Promise<AuthResponse> {
        const storedUsers = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
        const hashedPassword = await hashPassword(credentials.password);

        const user = storedUsers.find((u: any) =>
            u.username === credentials.username && u.password === hashedPassword
        );

        if (user) {
            const sessionUser = { username: user.username, role: user.role };
            // SESSION_KEY removed to prevent persistence across reloads
            return { success: true, user: sessionUser };
        }

        return { success: false, message: 'Invalid credentials' };
    },

    logout() {
        // No storage to clear
    },

    getCurrentUser(): User | null {
        // No persistence, so improved security: checking storage always returns null on reload
        return null;
    },

    async createUser(newUser: { username: string; password: string; role: Role }): Promise<AuthResponse> {
        const storedUsers = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');

        if (storedUsers.some((u: any) => u.username === newUser.username)) {
            return { success: false, message: 'Username already exists' };
        }

        const hashedPassword = await hashPassword(newUser.password);
        storedUsers.push({ ...newUser, password: hashedPassword });
        localStorage.setItem(USERS_KEY, JSON.stringify(storedUsers));

        return { success: true };
    }
};
