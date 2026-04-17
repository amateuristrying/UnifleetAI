import { useState, useEffect, useMemo } from "react";
import { driverScoresService } from "@/services/driverScoresV2";
import type { DriverScoreVehicleSummary } from "@/types/driverScoresV2";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { DriverScoresSummaryHeader } from "./components/DriverScoresSummaryHeader";
import { DriverScoresSectionList } from "./components/DriverScoresSectionList";
import { DriverScoresFilters } from "./components/DriverScoresFilters";

export function DriverScorePage() {
  const [vehicles, setVehicles] = useState<DriverScoreVehicleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState("All Regions");

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await driverScoresService.getFleetSummary();
      if (fetchError) throw fetchError;
      setVehicles(data || []);
    } catch (err: any) {
      console.error("Error fetching driver scores:", err);
      setError(err.message || "Failed to load vehicle data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const regions = useMemo(() => {
    const r = new Set<string>();
    vehicles.forEach(v => {
      if (v.ops_region) r.add(v.ops_region);
    });
    return ["All Regions", ...Array.from(r).sort()];
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => {
      const matchesSearch = 
        v.tracker_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.tracker_id?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesRegion = regionFilter === "All Regions" || v.ops_region === regionFilter;
      
      return matchesSearch && matchesRegion;
    });
  }, [vehicles, searchQuery, regionFilter]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mb-4" />
        <h3 className="text-xl font-bold mb-2">Something went wrong</h3>
        <p className="text-muted-foreground mb-6 max-w-md">{error}</p>
        <button 
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-main overflow-hidden">
      {/* Scrollable Content Container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Page Title & Intro */}
        <div className="flex flex-col gap-2 pt-4">
          <h1 className="text-4xl font-black tracking-tight text-foreground">Driver Scores</h1>
          <p className="text-muted-foreground max-w-2xl font-medium leading-relaxed">
            Monitor fleet-wide safety metrics and drill into individual vehicle behavior 
            over the last 30 rolling days.
          </p>
        </div>

        {/* KPI Summary Strip */}
        <DriverScoresSummaryHeader vehicles={vehicles} isLoading={isLoading} />

        {/* Search & Filters */}
        <DriverScoresFilters 
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          regionFilter={regionFilter}
          setRegionFilter={setRegionFilter}
          regions={regions}
          onRefresh={fetchData}
          isRefreshing={isLoading}
        />

        {/* Main List */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 bg-surface-card rounded-2xl border border-border shadow-sm">
            <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
            <p className="text-muted-foreground font-medium">Loading fleet data...</p>
          </div>
        ) : (
          <DriverScoresSectionList vehicles={filteredVehicles} />
        )}
      </div>
    </div>
  );
}
