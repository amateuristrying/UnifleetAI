import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

/**
 * Parses Navixy date strings which might be in "YYYY-MM-DD HH:mm:ss" format
 * or ISO format. Handles timezones assuming input is UTC if no suffix.
 */
export function parseNavixyDate(dateStr: string | undefined): Date {
    if (!dateStr) return new Date();

    // If it's standard ISO, Date.parse works
    if (dateStr.includes('T')) {
        return new Date(dateStr);
    }

    // Handle "YYYY-MM-DD HH:mm:ss" (Common Navixy format)
    // We assume it's UTC or server time. usually Navixy API returns server time.
    // For safety, we can treat it as local or UTC. 
    // Best guess: Replace space with T and append Z for UTC
    try {
        const isoLike = dateStr.replace(' ', 'T') + 'Z';
        return new Date(isoLike);
    } catch (e) {
        console.warn('Failed to parse date:', dateStr);
        return new Date();
    }
}

// Simple time ago formatter
export function formatTimeAgo(dateInput: string | Date | undefined): string {
    if (!dateInput) return 'Unknown';

    const date = typeof dateInput === 'string' ? parseNavixyDate(dateInput) : dateInput;
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
}

