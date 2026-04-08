import { Calendar, Filter, X, Radar } from 'lucide-react';
import { useState, useMemo, useRef } from 'react';
import { Vehicle } from '@/types/telemetry';
import MultiSelect from './MultiSelect';

interface FilterBarProps {
  vehicles: Vehicle[];
  // Filters are Arrays now
  filters: { brands: string[]; vehicles: string[]; showDeviatedOnly: boolean };
  onFilterChange: (newFilters: { brands: string[]; vehicles: string[]; showDeviatedOnly: boolean }) => void;
  onDateChange: (start: string, end: string) => void;
}

export default function FilterBar({ vehicles, filters, onFilterChange, onDateChange }: FilterBarProps) {
  const [dateType, setDateType] = useState<string>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  // Scanning State
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const abortScanRef = useRef(false);

  const startScan = async () => {
    setIsScanning(true);
    setScanProgress(0);
    abortScanRef.current = false;

    let totalProcessed = 0;
    let keepGoing = true;

    // Determine Date Range for Scan
    let dStart = '2024-01-01'; // Default far back
    let dEnd = new Date().toISOString().split('T')[0];

    if (customStart) dStart = customStart;
    else if (dateType === '7days') dStart = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    try {
      while (keepGoing && !abortScanRef.current) {
        const res = await fetch('/api/security/batch-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dateFrom: dStart,
            dateTo: dEnd,
            limit: 5 // Process 5 at a time
          })
        });

        if (!res.ok) break;

        const data = await res.json();
        if (data.success) {
          if (data.processed === 0) {
            keepGoing = false; // Done
          } else {
            totalProcessed += data.processed;
            setScanProgress(totalProcessed);
          }
        } else {
          keepGoing = false;
        }
      }
    } catch (e) {
      console.error('Scan failed', e);
    } finally {
      setIsScanning(false);
      // Auto-enable filter if we found stuff
      if (totalProcessed > 0) {
        onFilterChange({ ...filters, showDeviatedOnly: true });
      }
    }
  };

  // 1. Extract Unique Brands
  const allBrands = useMemo(() => {
    const unique = new Set(vehicles.map(v => v.tracker_brand).filter(Boolean));
    return Array.from(unique).sort();
  }, [vehicles]);

  // 2. Dynamic Vehicle Options
  // Logic: If brands selected, only show vehicles from those brands. Else show all.
  const filteredVehicleOptions = useMemo(() => {
    let available = vehicles;

    if (filters.brands.length > 0) {
      available = vehicles.filter(v => filters.brands.includes(v.tracker_brand));
    }

    // Return unique standardized names
    return Array.from(new Set(available.map(v => v.tracker_name))).sort();
  }, [vehicles, filters.brands]);

  // --- Handlers ---

  const handleBrandsChange = (selectedBrands: string[]) => {
    onFilterChange({ ...filters, brands: selectedBrands });
  };

  const handleVehiclesChange = (selectedVehicles: string[]) => {
    onFilterChange({ ...filters, vehicles: selectedVehicles });
  };

  const clearAllFilters = () => {
    onFilterChange({ brands: [], vehicles: [], showDeviatedOnly: false });
  };

  // --- Date Handlers (Standard) ---
  const handleDateTypeChange = (val: string) => {
    setDateType(val);
    if (val === 'custom') return;

    const now = new Date();
    let start = new Date();

    if (val === 'today') start.setDate(now.getDate());
    if (val === '7days') start.setDate(now.getDate() - 7);
    if (val === '30days') start.setDate(now.getDate() - 30);
    if (val === 'all') start = new Date('2000-01-01');

    const startStr = start.toISOString().split('T')[0];
    const endStr = now.toISOString().split('T')[0];

    setCustomStart(startStr);
    setCustomEnd(endStr);
    onDateChange(startStr, endStr);
  };

  const handleCustomDateChange = (start: string, end: string) => {
    setCustomStart(start);
    setCustomEnd(end);
    if (start && end) onDateChange(start, end);
  };

  return (
    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6 flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 items-center justify-between">

        {/* Filters Section */}
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="flex items-center gap-2 text-gray-600 mr-2">
            <Filter size={18} />
            <span className="text-sm font-medium">Filters:</span>
          </div>

          <MultiSelect
            label="Brands"
            options={allBrands}
            selected={filters.brands}
            onChange={handleBrandsChange}
            placeholder="All Brands"
          />

          <MultiSelect
            label="Vehicles"
            options={filteredVehicleOptions}
            selected={filters.vehicles}
            onChange={handleVehiclesChange}
            placeholder="All Vehicles"
          />

          {(filters.brands.length > 0 || filters.vehicles.length > 0 || filters.showDeviatedOnly) && (
            <button
              onClick={clearAllFilters}
              className="mt-5 text-gray-400 hover:text-red-500 transition-colors p-1"
              title="Clear All Filters"
            >
              <X size={20} />
            </button>
          )}

          {/* New Deviation Toggle */}
          <div className="flex items-center gap-2 mt-5 ml-2 border-l border-gray-200 pl-4">
            <label className="flex items-center cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={filters.showDeviatedOnly}
                  onChange={(e) => onFilterChange({ ...filters, showDeviatedOnly: e.target.checked })}
                />
                <div className={`block w-10 h-6 rounded-full transition-colors ${filters.showDeviatedOnly ? 'bg-red-500' : 'bg-gray-300'}`}></div>
                <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${filters.showDeviatedOnly ? 'translate-x-4' : ''}`}></div>
              </div>
              <div className="ml-3 text-sm font-medium text-gray-700 group-hover:text-red-600 transition-colors">
                High Deviation Only
              </div>
            </label>
          </div>
        </div>

        {/* Date Section */}
        <div className="flex items-center gap-2 mt-4 sm:mt-0">
          <span className="text-sm text-gray-500 font-medium mr-2 flex items-center gap-1">
            <Calendar size={16} /> Date:
          </span>
          <select
            value={dateType}
            className="border border-gray-200 rounded-lg py-2 px-3 text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none"
            onChange={(e) => handleDateTypeChange(e.target.value)}
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
      </div>

      {/* Custom Date Inputs */}
      {dateType === 'custom' && (
        <div className="flex items-center gap-3 justify-end bg-gray-50 p-2 rounded-lg border border-gray-100 animate-in fade-in slide-in-from-top-1">
          <span className="text-sm text-gray-500">From:</span>
          <input
            type="date"
            value={customStart}
            onChange={(e) => handleCustomDateChange(e.target.value, customEnd)}
            className="border border-gray-200 rounded-md px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <span className="text-sm text-gray-500">To:</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => handleCustomDateChange(customStart, e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Batch Analysis Controls */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="flex items-center gap-2">
          {isScanning ? (
            <div className="flex items-center gap-3 text-sm font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full animate-pulse">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
              Analyzing Fleet: {scanProgress} trips processed...
            </div>
          ) : (
            <button
              onClick={startScan}
              disabled={filters.showDeviatedOnly}
              className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
            >
              <Radar size={14} />
              Scan for Deviations
            </button>
          )}
        </div>

        <div className="text-[10px] text-gray-400">
          {filters.showDeviatedOnly ? 'Showing verified >120s deviations' : 'Scan to detect hidden deviations'}
        </div>
      </div>
    </div>
  );
}