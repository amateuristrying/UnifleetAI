import { Button } from "./ui/button"
import { ChevronDown, Maximize } from "lucide-react"

export function SubHeader() {
    return (
        <div className="flex h-[50px] w-full items-center justify-between bg-[#f0f2f5] px-6">
            {/* Title */}
            <h1 className="text-xl font-bold text-gray-700">Run Time Status</h1>

            {/* Right Controls */}
            <div className="flex items-center gap-3">
                {/* Dropdown Simulator */}
                <div className="flex items-center justify-between h-9 w-[180px] bg-white border border-gray-300 rounded-md px-3 text-sm text-gray-600 shadow-sm cursor-pointer">
                    <span>All Devices</span>
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                </div>

                {/* Fullscreen Icon */}
                <Button variant="ghost" size="icon" className="h-9 w-9 text-gray-500 hover:text-gray-800">
                    <Maximize className="h-5 w-5" />
                </Button>
            </div>
        </div>
    )
}
