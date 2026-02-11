import { GitFork } from "lucide-react";

export function RouteMaster() {
    return (
        <div className="h-full p-6 flex flex-col items-center justify-center text-center">
            <div className="bg-purple-50 dark:bg-purple-500/10 p-6 rounded-full mb-4">
                <GitFork className="h-12 w-12 text-purple-600 dark:text-purple-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Route Master</h2>
            <p className="text-muted-foreground max-w-md">
                Route planning and optimization tools coming soon.
            </p>
        </div>
    );
}
