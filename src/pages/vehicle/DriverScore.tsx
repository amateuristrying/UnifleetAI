import { UserCheck } from "lucide-react";

export function DriverScore() {
    return (
        <div className="h-full p-6 flex flex-col items-center justify-center text-center">
            <div className="bg-blue-50 dark:bg-blue-500/10 p-6 rounded-full mb-4">
                <UserCheck className="h-12 w-12 text-blue-600 dark:text-blue-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Driver Score</h2>
            <p className="text-muted-foreground max-w-md">
                Driver performance metrics and scoring system coming soon.
            </p>
        </div>
    );
}
