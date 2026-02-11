import { Card, CardContent } from "./ui/card"
import { Badge } from "./ui/badge"
import { Edit2, Truck, Code, RefreshCw, MapPin, Clock } from "lucide-react"
import type { Vehicle } from "@/data/mock"
import { useEffect, useRef } from "react"

interface VehicleListProps {
    vehicles: Vehicle[];
    selectedVehicleId?: string | null;
    onVehicleClick?: (id: string) => void;
}

export function VehicleList({ vehicles, selectedVehicleId, onVehicleClick }: VehicleListProps) {
    const selectedRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (selectedVehicleId && selectedRef.current) {
            selectedRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    }, [selectedVehicleId]);

    if (vehicles.length === 0) {
        return (
            <div className="p-8 text-center text-muted-foreground text-sm">
                No vehicles found or loading...
            </div>
        )
    }

    return (
        <div className="flex w-full flex-col gap-3 p-3">
            {vehicles.map((vehicle, index) => {
                const isSelected = vehicle.id === selectedVehicleId;

                return (
                    <div
                        key={`${vehicle.id}-${index}`}
                        ref={isSelected ? selectedRef : null}
                    >
                        <Card
                            className={`relative border shadow-sm transition-all cursor-pointer rounded-[18px] ${isSelected
                                ? 'border-primary shadow-lg bg-primary/5 ring-2 ring-primary/20'
                                : 'border-border hover:shadow-md hover:border-primary/30'
                                }`}
                            onClick={() => onVehicleClick?.(vehicle.id)}
                        >
                            <CardContent className="p-3">
                                <div className="flex justify-between items-start">
                                    {/* Left Info */}
                                    <div className="flex flex-col gap-1 w-full">
                                        <div className="flex items-center justify-between w-full">
                                            <span className={`font-semibold text-base ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                                                {vehicle.name}
                                            </span>
                                            {/* Icons actions */}
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <Edit2 className="h-3.5 w-3.5 hover:text-primary cursor-pointer" />
                                                <Truck className="h-3.5 w-3.5 hover:text-primary cursor-pointer" />
                                                <Code className="h-3.5 w-3.5 hover:text-primary cursor-pointer" />
                                                <RefreshCw className="h-3.5 w-3.5 hover:text-primary cursor-pointer" />
                                            </div>
                                        </div>

                                        <div className="text-sm font-normal text-muted-foreground mb-1">Driver: {vehicle.driver}</div>

                                        <div className="flex items-center gap-1 text-[11px] leading-none mb-1">
                                            <Clock className="h-3 w-3 text-cyan-500" />
                                            <span className="text-cyan-600 dark:text-cyan-400 font-medium">{vehicle.timeAgo}</span>
                                            <span className="text-border mx-1">|</span>
                                            <span className="text-muted-foreground">Speed: {vehicle.speed.toFixed(2)} km/h</span>
                                        </div>

                                        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground max-w-[75%]">
                                            <MapPin className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                                            <span className="leading-tight line-clamp-2">
                                                {vehicle.coordinates[0] !== 0 && vehicle.coordinates[1] !== 0
                                                    ? `${vehicle.coordinates[0].toFixed(4)}, ${vehicle.coordinates[1].toFixed(4)}`
                                                    : vehicle.address || 'Location unknown'
                                                }
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Status Pill */}
                                <div className="absolute bottom-3 right-3">
                                    <Badge className={`text-xs px-3 py-0.5 font-normal rounded-md ${vehicle.status === "Running" ? "bg-[#22C55E] text-white hover:bg-[#16A34A]" :
                                        vehicle.status === "Stopped" ? "bg-[#3B82F6] text-white hover:bg-[#2563EB]" :
                                            vehicle.status === "Idle" ? "bg-[#EAB308] text-black hover:bg-[#CA8A04]" :
                                                vehicle.status === "Not Online" ? "bg-[#9CA3AF] text-white hover:bg-[#6B7280]" :
                                                    vehicle.status === "Not Working" ? "bg-[#EF4444] text-white hover:bg-[#DC2626]" :
                                                        "bg-muted text-foreground"
                                        }`}>
                                        {vehicle.status}
                                    </Badge>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                );
            })}
        </div>
    )
}
