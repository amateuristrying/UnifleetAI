/**
 * TruckIcon Component - Clean geometric status markers
 *
 * Status types:
 * - Running:     Green directional arrow (rotates by heading)
 * - Stopped:     Solid red circle
 * - Idle:        Orange circle with animated inner ring
 * - Not Online:  Gray hollow circle with X
 * - Not Working: Dark circle with "!" and rotating dashed ring
 */

import type { VehicleStatus } from '@/data/mock';

interface TruckIconProps {
    status: VehicleStatus;
    className?: string;
    isSelected?: boolean;
    /** GPS heading in degrees – only used for 'Running' arrow rotation */
    heading?: number;
}

// Status ➜ color map
const STATUS_COLORS: Record<VehicleStatus, string> = {
    Running: '#22c55e',
    Stopped: '#ef4444',
    Idle: '#f97316',
    'Not Online': '#9ca3af',
    'Not Working': '#1f2937',
};

export function TruckIcon({
    status,
    className = 'w-10 h-10',
    isSelected = false,
    heading = 0,
}: TruckIconProps) {
    const color = STATUS_COLORS[status] ?? '#6b7280';
    const selectedFilter = isSelected
        ? 'drop-shadow(0 0 6px rgba(59,130,246,0.8))'
        : 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))';

    switch (status) {
        /* ── Moving: directional arrow ── */
        case 'Running':
            return (
                <div
                    className={className}
                    style={{
                        transform: `rotate(${heading}deg)`,
                        transformOrigin: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <svg
                        width="100%"
                        height="100%"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ filter: selectedFilter }}
                    >
                        <path
                            d="M12 2L4 20L12 16L20 20L12 2Z"
                            fill={color}
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>
            );

        /* ── Stopped: solid circle ── */
        case 'Stopped':
            return (
                <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg
                        width="100%"
                        height="100%"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ filter: selectedFilter }}
                    >
                        <circle cx="12" cy="12" r="8" fill={color} />
                    </svg>
                </div>
            );

        /* ── Idle: circle with pulsing inner ring ── */
        case 'Idle':
            return (
                <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg
                        width="100%"
                        height="100%"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ filter: selectedFilter }}
                    >
                        <circle cx="12" cy="12" r="9" fill={color} />
                        <circle
                            cx="12"
                            cy="12"
                            r="5"
                            fill="none"
                            stroke="white"
                            strokeWidth="1.5"
                            opacity="0.7"
                        >
                            <animate
                                attributeName="opacity"
                                values="0.7;0.3;0.7"
                                dur="2s"
                                repeatCount="indefinite"
                            />
                        </circle>
                    </svg>
                </div>
            );

        /* ── Not Online: hollow circle with X ── */
        case 'Not Online':
            return (
                <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg
                        width="100%"
                        height="100%"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ filter: selectedFilter }}
                    >
                        <circle cx="12" cy="12" r="8" fill="white" stroke={color} strokeWidth="2" />
                        <line x1="8" y1="8" x2="16" y2="16" stroke={color} strokeWidth="2" strokeLinecap="round" />
                        <line x1="16" y1="8" x2="8" y2="16" stroke={color} strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </div>
            );

        /* ── Not Working: dark circle with "!" + rotating dashed ring ── */
        case 'Not Working':
            return (
                <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg
                        width="100%"
                        height="100%"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ filter: selectedFilter }}
                    >
                        <circle cx="12" cy="12" r="9" fill={color} stroke="white" strokeWidth="2" />
                        <text
                            x="12"
                            y="17"
                            textAnchor="middle"
                            fill="white"
                            fontFamily="Arial, sans-serif"
                            fontSize="14"
                            fontWeight="bold"
                        >
                            !
                        </text>
                    </svg>
                </div>
            );

        default:
            return (
                <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg
                        width="100%"
                        height="100%"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ filter: selectedFilter }}
                    >
                        <circle cx="12" cy="12" r="8" fill="#6b7280" />
                    </svg>
                </div>
            );
    }
}

/**
 * Get SVG string for a status (used for Mapbox image loading).
 * heading is in degrees for the 'Running' arrow.
 */
export function getTruckIconSvg(
    status: VehicleStatus,
    isSelected: boolean = false,
    heading: number = 0,
): string {
    const color = STATUS_COLORS[status] ?? '#6b7280';
    const filter = isSelected
        ? 'filter="url(#glow)"'
        : '';
    const glowDef = isSelected
        ? `<defs><filter id="glow"><feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="rgba(59,130,246,0.8)"/></filter></defs>`
        : '';

    switch (status) {
        case 'Running':
            return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" ${filter}>
                ${glowDef}
                <g transform="rotate(${heading} 12 12)">
                    <path d="M12 2L4 20L12 16L20 20L12 2Z" fill="${color}" stroke-linejoin="round"/>
                </g>
            </svg>`;

        case 'Stopped':
            return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" ${filter}>
                ${glowDef}
                <circle cx="12" cy="12" r="8" fill="${color}"/>
            </svg>`;

        case 'Idle':
            return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" ${filter}>
                ${glowDef}
                <circle cx="12" cy="12" r="9" fill="${color}"/>
                <circle cx="12" cy="12" r="5" fill="none" stroke="white" stroke-width="1.5" opacity="0.7"/>
            </svg>`;

        case 'Not Online':
            return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" ${filter}>
                ${glowDef}
                <circle cx="12" cy="12" r="8" fill="white" stroke="${color}" stroke-width="2"/>
                <line x1="8" y1="8" x2="16" y2="16" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
                <line x1="16" y1="8" x2="8" y2="16" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
            </svg>`;

        case 'Not Working':
            return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" ${filter}>
                ${glowDef}
                <circle cx="12" cy="12" r="9" fill="${color}" stroke="white" stroke-width="2"/>
                <text x="12" y="17" text-anchor="middle" fill="white" font-family="Arial" font-size="14" font-weight="bold">!</text>
            </svg>`;

        default:
            return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="8" fill="#6b7280"/>
            </svg>`;
    }
}
