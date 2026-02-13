import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { format } from 'date-fns';

interface BorderTrend {
    day_date: string;
    avg_wait_hours: number;
    truck_count: number;
}

interface BorderChartProps {
    data: BorderTrend[];
    loading: boolean;
}

export function BorderChart({ data, loading }: BorderChartProps) {
    if (loading) {
        return <div className="h-[300px] w-full bg-surface-card animate-pulse rounded-lg" />
    }

    if (!data || data.length === 0) {
        return (
            <div className="h-[300px] w-full bg-surface-card rounded-lg flex items-center justify-center border border-border">
                <p className="text-muted-foreground">No data available for the selected period.</p>
            </div>
        )
    }

    return (
        <div className="h-[350px] w-full bg-surface-card p-4 rounded-lg border border-border shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-4">Border Wait Time Trend (Daily Avg)</h3>
            <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis
                            dataKey="day_date"
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                            tickFormatter={(val) => format(new Date(val), 'MMM dd')}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                            tickFormatter={(val) => `${val}h`}
                            tickLine={false}
                            axisLine={false}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--popover-foreground))' }}
                            itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                            labelFormatter={(label) => format(new Date(label), 'PPP')}
                        />
                        <Legend wrapperStyle={{ paddingTop: '10px' }} />
                        <Line
                            type="monotone"
                            dataKey="avg_wait_hours"
                            name="Avg Wait (Hrs)"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={{ r: 3, fill: 'hsl(var(--primary))' }}
                            activeDot={{ r: 6 }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
