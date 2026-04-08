import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

/**
 * Parses a Navixy date string.
 * Navixy often return dates in "YYYY-MM-DD HH:mm:ss" format without timezone info.
 * The server time is typically Dar es Salaam time (UTC+3).
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
        return new Date(dateString.replace(' ', 'T') + '+03:00');
    }

    // Fallback
    return new Date(dateString);
}
