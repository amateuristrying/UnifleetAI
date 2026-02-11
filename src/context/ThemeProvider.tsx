import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeCtx {
    theme: Theme;
    setTheme: (t: Theme) => void;
    /** Resolved value – always 'light' | 'dark' */
    resolved: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeCtx>({
    theme: 'light',
    setTheme: () => { },
    resolved: 'light',
});

const STORAGE_KEY = 'unifleet-theme';

function getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        return (stored as Theme) || 'light';
    });

    const resolved = theme === 'system' ? getSystemTheme() : theme;

    // Apply class on <html>
    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(resolved);
    }, [resolved]);

    // Listen for system theme changes when mode is 'system'
    useEffect(() => {
        if (theme !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => setThemeState('system'); // trigger re-render
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [theme]);

    const setTheme = (t: Theme) => {
        localStorage.setItem(STORAGE_KEY, t);
        setThemeState(t);
    };

    return (
        <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
            {children}
        </ThemeContext.Provider>
    );
}

export const useTheme = () => useContext(ThemeContext);
