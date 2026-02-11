// src/components/SmartDateXAxis.tsx
import { XAxis } from 'recharts';

export interface SmartDateXAxisProps {
    data: unknown[];
    dataKey: string;
    maxTicks?: number;
    height?: number;
    angle?: number;
    tickStyle?: React.CSSProperties;
    tickFormatter?: (v: string) => string;
}

function defaultFormat(v: string) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return String(v);
}

export function SmartDateXAxis({
    data,
    dataKey,
    maxTicks = 7,
    height = 80,
    angle = -45,
    tickStyle = { fontSize: 12, fontWeight: 500 },
    tickFormatter,
}: SmartDateXAxisProps) {
    const rawVals: string[] = (data || []).map((d) => String((d as Record<string, unknown>)?.[dataKey] ?? ''));
    const validIdx: number[] = [];
    rawVals.forEach((v, i) => {
        const t = new Date(v).getTime();
        if (!isNaN(t)) validIdx.push(i);
    });

    let ticks: string[] = [];
    if (validIdx.length > 0) {
        const n = validIdx.length;
        const step = Math.max(1, Math.ceil(n / maxTicks));
        const chosen = new Set<number>();
        for (let i = 0; i < n; i += step) chosen.add(validIdx[i]);
        chosen.add(validIdx[0]);
        chosen.add(validIdx[n - 1]);
        ticks = Array.from(chosen).sort((a, b) => a - b).map((i) => rawVals[i]);
    }

    const fmt = (v: unknown) => (tickFormatter ? tickFormatter(String(v)) : defaultFormat(String(v)));

    return (
        <XAxis
            dataKey={dataKey}
            ticks={ticks}
            height={height}
            angle={angle}
            textAnchor="end"
            stroke="#9CA3AF"
            strokeWidth={1}
            tick={tickStyle as object}
            tickFormatter={fmt}
        />
    );
}
