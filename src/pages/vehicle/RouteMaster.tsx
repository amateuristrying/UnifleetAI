import RouteManager from '@/components/maps/RouteManager';

export function RouteMaster() {
    return (
        <div className="flex flex-1 flex-col h-full w-full overflow-hidden px-6 pt-8 pb-3 bg-background">
            <div className="flex-1 h-full w-full rounded-[24px] overflow-hidden shadow-lg border border-border relative bg-surface-card">
                <RouteManager />
            </div>
        </div>
    );
}
