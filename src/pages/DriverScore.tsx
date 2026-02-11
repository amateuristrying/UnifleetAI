import { useState, useEffect } from "react";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { Download, Loader2, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchDriverScoreData } from "@/services/driverScore";
import { calculateDriverScores } from "@/services/scoringLogic";
import type { VehicleScore } from "@/types/driverScore";
import { ScoreCard } from "@/components/driver-score/ScoreCard";
import { Button } from "@/components/ui/button";

type TimeFilter = "today" | "7d" | "30d" | "all";

export function DriverScore() {
    const [filter, setFilter] = useState<TimeFilter>("30d");
    const [scores, setScores] = useState<VehicleScore[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch Data
    useEffect(() => {
        async function loadData() {
            setIsLoading(true);
            setError(null);
            try {
                let start = new Date();
                let end = new Date();

                // Calculate Date Range
                const now = new Date();
                if (filter === "today") {
                    start = startOfDay(now);
                    end = endOfDay(now);
                } else if (filter === "7d") {
                    start = subDays(now, 7);
                    end = endOfDay(now);
                } else if (filter === "30d") {
                    start = subDays(now, 30);
                    end = endOfDay(now);
                } else if (filter === "all") {
                    start = new Date('2026-01-01'); // Start of data availability
                    end = endOfDay(now);
                }

                // Service Call (Clamping happens inside service)
                const data = await fetchDriverScoreData(start, end);

                // Calculate Scores
                const calculatedScores = calculateDriverScores(
                    data.trips,
                    data.stops,
                    data.engineHours,
                    data.speedViolations
                );

                setScores(calculatedScores);

            } catch (err) {
                console.error(err);
                setError("Failed to load driver scores. Please try again.");
            } finally {
                setIsLoading(false);
            }
        }

        loadData();
    }, [filter]);


    return (
        <div className="flex flex-col h-full bg-surface-main p-6 overflow-y-auto w-full">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Trophy className="h-6 w-6 text-primary" />
                        Driver Scoreboard
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Performance ranking based on safety, efficiency, and compliance.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    {/* Time Filter */}
                    <div className="bg-muted p-1 rounded-lg flex items-center">
                        <FilterButton active={filter === 'today'} onClick={() => setFilter('today')}>Today</FilterButton>
                        <FilterButton active={filter === '7d'} onClick={() => setFilter('7d')}>Last 7 Days</FilterButton>
                        <FilterButton active={filter === '30d'} onClick={() => setFilter('30d')}>Last 30 Days</FilterButton>
                        <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All Time</FilterButton>
                    </div>

                    {/* PDF Download Stub */}
                    <Button variant="outline" className="gap-2">
                        <Download className="h-4 w-4" />
                        Download PDF
                    </Button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 max-w-5xl mx-auto w-full">

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin mb-4" />
                        <p>Calculating scores...</p>
                    </div>
                ) : error ? (
                    <div className="p-8 text-center text-red-500 bg-red-50 rounded-lg border border-red-100">
                        {error}
                    </div>
                ) : scores.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground bg-surface-card rounded-lg border border-dashed">
                        No vehicle activity found for the selected period.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {scores.map((vehicle) => (
                            <ScoreCard key={vehicle.trackerId} vehicle={vehicle} />
                        ))}
                    </div>
                )}

            </div>
        </div>
    );
}

function FilterButton({ active, children, onClick }: { active: boolean, children: React.ReactNode, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
                active
                    ? "bg-surface-card shadow-sm text-primary"
                    : "text-muted-foreground hover:text-foreground"
            )}
        >
            {children}
        </button>
    )
}
