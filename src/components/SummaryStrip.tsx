import { METRICS } from "@/data/mock"
import { Download, LayoutGrid } from "lucide-react"

export function SummaryStrip() {
    return (
        <div className="w-full px-6 py-3 text-[11px] bg-white border-b border-gray-200">
            <div className="flex w-full items-start gap-8">

                {/* Use a grid for the metrics to ensure alignment */}
                <div className="grid grid-cols-5 gap-6 flex-1">
                    {/* Column 1 */}
                    <div className="flex flex-col gap-0.5">
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.total}</span>
                            <span className="text-gray-600 flex-1">Total vehicles</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-orange-500 font-bold w-5">{METRICS.idle < 10 ? `0${METRICS.idle}` : METRICS.idle}</span>
                            <span className="text-orange-500 flex-1">Vehicles Idle</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-cyan-500 font-bold w-5">{METRICS.notWorking < 10 ? `0${METRICS.notWorking}` : METRICS.notWorking}</span>
                            <span className="text-cyan-500 flex-1">Vehicles Not Working</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.immobilized < 10 ? `0${METRICS.immobilized}` : METRICS.immobilized}</span>
                            <span className="text-gray-700 flex-1">Vehicles Immobilized</span>
                        </div>
                    </div>

                    {/* Column 2 */}
                    <div className="flex flex-col gap-0.5">
                        <div className="flex gap-2 justify-between">
                            <span className="text-green-600 font-bold w-5">{METRICS.moving}</span>
                            <span className="text-green-600 flex-1">Vehicles Moving</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-red-500 font-bold w-5">{METRICS.stopped < 10 ? `0${METRICS.stopped}` : METRICS.stopped}</span>
                            <span className="text-red-500 flex-1">Vehicles Stopped</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.discharged < 10 ? `0${METRICS.discharged}` : METRICS.discharged}</span>
                            <span className="text-gray-700 flex-1">Vehicles Discharged</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.removed < 10 ? `0${METRICS.removed}` : METRICS.removed}</span>
                            <span className="text-gray-700 flex-1">Vehicles Removed</span>
                        </div>
                    </div>

                    {/* Column 3 */}
                    <div className="flex flex-col gap-0.5 text-gray-500">
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.notOnline}</span>
                            <span className="flex-1">Not Online</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.onJob}</span>
                            <span className="flex-1">On Job</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.late}</span>
                            <span className="flex-1">Late</span>
                        </div>
                    </div>

                    {/* Column 4 */}
                    <div className="flex flex-col gap-0.5 text-gray-500">
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.waitingToLoad < 10 ? `0${METRICS.waitingToLoad}` : METRICS.waitingToLoad}</span>
                            <span className="flex-1">Waiting to load</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.loaded < 10 ? `0${METRICS.loaded}` : METRICS.loaded}</span>
                            <span className="flex-1">Loaded</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.unloading < 10 ? `0${METRICS.unloading}` : METRICS.unloading}</span>
                            <span className="flex-1">Unloading</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.scheduled < 10 ? `0${METRICS.scheduled}` : METRICS.scheduled}</span>
                            <span className="flex-1">Scheduled</span>
                        </div>
                    </div>

                    {/* Column 5 */}
                    <div className="flex flex-col gap-0.5 text-gray-500">
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.loading < 10 ? `0${METRICS.loading}` : METRICS.loading}</span>
                            <span className="flex-1">Loading</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.waitingToUnload < 10 ? `0${METRICS.waitingToUnload}` : METRICS.waitingToUnload}</span>
                            <span className="flex-1">Waiting to unload</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.empty < 10 ? `0${METRICS.empty}` : METRICS.empty}</span>
                            <span className="flex-1">Empty</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.onTime < 10 ? `0${METRICS.onTime}` : METRICS.onTime}</span>
                            <span className="flex-1">On Time</span>
                        </div>
                        <div className="flex gap-2 justify-between">
                            <span className="text-gray-900 font-bold w-5">{METRICS.early < 10 ? `0${METRICS.early}` : METRICS.early}</span>
                            <span className="flex-1">Early</span>
                        </div>
                    </div>
                </div>

                {/* Right side icons */}
                <div className="flex items-start gap-2 text-gray-500 shrink-0 ml-4">
                    <button className="hover:text-gray-800 transition-colors"><LayoutGrid className="h-5 w-5" /></button>
                    <button className="hover:text-gray-800 transition-colors"><Download className="h-5 w-5" /></button>
                </div>
            </div>
        </div>
    )
}
