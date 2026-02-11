import { Input } from "./ui/input"
import { Button } from "./ui/button"
import { Search, Filter, Check } from "lucide-react"
import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"

interface SearchRowProps {
    currentFilter?: string
    onFilterChange?: (filter: string) => void
    searchQuery?: string
    onSearchChange?: (query: string) => void
}

const FILTERS = [
    { label: "All Devices", value: "All" },
    { label: "Idle", value: "Idle" },
    { label: "Not Working", value: "Not Working" },
    { label: "Moving/Running", value: "Running" },
    { label: "Stopped", value: "Stopped" },
    { label: "Not Online", value: "Not Online" }
]

export function SearchRow({
    currentFilter = "All",
    onFilterChange,
    searchQuery = "",
    onSearchChange
}: SearchRowProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [localSearch, setLocalSearch] = useState(searchQuery)

    const dropdownRef = useRef<HTMLDivElement>(null)
    const debounceRef = useRef<NodeJS.Timeout | null>(null)

    useEffect(() => {
        setLocalSearch(searchQuery)
    }, [searchQuery])

    const triggerSearch = useCallback(
        (value: string) => {
            if (debounceRef.current) clearTimeout(debounceRef.current)

            debounceRef.current = setTimeout(() => {
                onSearchChange?.(value)
            }, 300)
        },
        [onSearchChange]
    )

    const handleChange = (value: string) => {
        setLocalSearch(value)
        triggerSearch(value)
    }

    const handleManualSearch = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        onSearchChange?.(localSearch)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") handleManualSearch()
    }

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false)
            }
        }

        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const handleSelect = (value: string) => {
        onFilterChange?.(value)
        setIsOpen(false)
    }

    return (
        <div className="flex w-full items-center gap-3 relative">
            {/* Search Input Box */}
            <div className="relative flex-1 flex items-center bg-white rounded-[18px] shadow-sm border border-border/40 group focus-within:ring-2 focus-within:ring-primary/10 transition-all">
                <Input
                    placeholder="Search Device"
                    className="pl-4 pr-10 h-12 rounded-[18px] border-none bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                    value={localSearch}
                    onChange={(e) => handleChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                />

                <button
                    onClick={handleManualSearch}
                    className="absolute right-3 p-1.5 hover:bg-muted rounded-full transition-colors cursor-pointer text-muted-foreground/60 hover:text-primary"
                >
                    <Search className="h-5 w-5" />
                </button>
            </div>

            {/* Filter Dropdown Box */}
            <div className="relative" ref={dropdownRef}>
                <Button
                    size="icon"
                    className={cn(
                        "h-12 w-12 rounded-[18px] shadow-sm transition-all flex items-center justify-center border-none",
                        currentFilter !== "All"
                            ? "bg-primary hover:bg-primary/90"
                            : "bg-black hover:bg-zinc-800"
                    )}
                    onClick={() => setIsOpen((prev) => !prev)}
                >
                    <Filter
                        className="h-5 w-5 text-white"
                        fill={currentFilter !== "All" ? "white" : "none"}
                    />
                </Button>

                {isOpen && (
                    <div className="absolute right-0 top-[56px] w-56 bg-surface-card rounded-2xl shadow-2xl border border-border py-2 z-50 animate-in fade-in slide-in-from-top-2">
                        <div className="px-4 py-2 border-b border-border/50 mb-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Filter Assets</p>
                        </div>
                        {FILTERS.map((f) => (
                            <button
                                key={f.value}
                                onClick={() => handleSelect(f.value)}
                                className={cn(
                                    "w-full text-left px-4 py-2.5 text-sm flex items-center justify-between hover:bg-muted transition-colors",
                                    currentFilter === f.value
                                        ? "text-primary font-bold bg-primary/5"
                                        : "text-muted-foreground"
                                )}
                            >
                                {f.label}
                                {currentFilter === f.value && <Check className="h-4 w-4" />}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
