import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

/**
 * Parses Navixy date strings which might be in "YYYY-MM-DD HH:mm:ss" format
 * or ISO format. Handles timezones assuming input is UTC if no suffix.
 */
export function parseNavixyDate(dateString: string | undefined): Date {
    if (!dateString) return new Date();

    // If it's already a valid ISO string with timezone, just use it
    if (dateString.includes('T') && (dateString.includes('Z') || dateString.match(/[+-]\d{2}:?\d{2}$/))) {
        return new Date(dateString);
    }

    // Handle "YYYY-MM-DD HH:mm:ss" format
    if (dateString.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        // Convert to ISO-ish and append Tanzania offset (+03:00)
        // This fixes the issue where local time was treated as UTC, causing 3h shift
        return new Date(dateString.replace(' ', 'T') + '+03:00');
    }

    // Fallback
    return new Date(dateString);
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

