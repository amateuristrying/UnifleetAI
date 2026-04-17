import { useState, useMemo } from "react";
import type { DriverScoreVehicleSummary } from "@/types/driverScoresV2";
import { DriverScoresVehicleRow } from "./DriverScoresVehicleRow";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  vehicles: DriverScoreVehicleSummary[];
}

const BUCKET_ORDER = ['Critical', 'Watchlist', 'Stable', 'Inactive'] as const;

export function DriverScoresSectionList({ vehicles }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const groupedVehicles = useMemo(() => {
    const groups: Record<string, DriverScoreVehicleSummary[]> = {};
    BUCKET_ORDER.forEach(b => (groups[b] = []));

    vehicles.forEach(v => {
      const bucket = v.ui_bucket || 'Inactive';
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(v);
    });

    return groups;
  }, [vehicles]);

  if (vehicles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-surface-card rounded-2xl border border-dashed border-border text-center">
        <Inbox className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
        <h3 className="text-xl font-bold mb-1">No vehicles found</h3>
        <p className="text-muted-foreground">Adjust your search or filters to see results.</p>
      </div>
    );
  }

  return (
    <div className="space-y-12 pb-20">
      {BUCKET_ORDER.map(bucket => {
        const list = groupedVehicles[bucket];
        if (list.length === 0) return null;

        return (
          <div key={bucket} className="space-y-4">
            {/* Section Header */}
            <div className="flex items-center justify-between px-2 mb-2">
              <div className="flex items-center gap-4">
                <div className={cn("w-2 h-6 rounded-full", getBucketColor(bucket as any))} />
                <h2 className="text-2xl font-black uppercase tracking-tight text-foreground">{bucket}</h2>
                <div className="flex items-center justify-center bg-muted/50 px-3 py-1 rounded-full border border-border">
                  <span className="text-xs font-black text-muted-foreground">
                    {list.length} Vehicles
                  </span>
                </div>
              </div>
            </div>

            {/* Section Body - Rows */}
            <div className="space-y-1">
              {list.map((v, idx) => (
                <DriverScoresVehicleRow 
                  key={v.tracker_id} 
                  vehicle={v} 
                  isExpanded={expandedId === v.tracker_id}
                  onToggle={() => setExpandedId((prev: string | null) => prev === v.tracker_id ? null : v.tracker_id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getBucketColor(bucket: 'Critical' | 'Watchlist' | 'Stable' | 'Inactive') {
  const colors = {
    Critical: "bg-red-500",
    Watchlist: "bg-amber-500",
    Stable: "bg-emerald-500",
    Inactive: "bg-slate-400",
  };
  return colors[bucket] || "bg-slate-300";
}
