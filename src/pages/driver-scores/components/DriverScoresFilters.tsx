import { Search, Filter, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  regionFilter: string;
  setRegionFilter: (val: string) => void;
  regions: string[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function DriverScoresFilters({
  searchQuery,
  setSearchQuery,
  regionFilter,
  setRegionFilter,
  regions,
  onRefresh,
  isRefreshing
}: Props) {
  return (
    <div className="flex flex-col md:flex-row items-center gap-4 bg-surface-card p-4 rounded-2xl border border-border shadow-sm">
      {/* Search Input */}
      <div className="relative flex-1 w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by vehicle name or ID..."
          className="w-full bg-muted/50 border border-border rounded-xl pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button 
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Region Filter */}
      <div className="flex items-center gap-2 w-full md:w-auto">
        <Filter className="w-4 h-4 text-muted-foreground hidden md:block" />
        <select
          className="bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all w-full md:w-48 appearance-none cursor-pointer"
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
        >
          {regions.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Refresh Action */}
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className={cn(
          "flex items-center justify-center gap-2 px-6 py-2.5 bg-foreground text-background font-bold text-sm rounded-xl hover:opacity-90 transition-all disabled:opacity-50 w-full md:w-auto",
          isRefreshing && "cursor-not-allowed"
        )}
      >
        <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
        {isRefreshing ? "Refreshing..." : "Refresh Fleet"}
      </button>

      {/* Reset Filter Button */}
      {(searchQuery || regionFilter !== "All Regions") && (
        <button
          onClick={() => {
            setSearchQuery("");
            setRegionFilter("All Regions");
          }}
          className="text-sm font-medium text-primary hover:underline px-2"
        >
          Reset Filters
        </button>
      )}
    </div>
  );
}
