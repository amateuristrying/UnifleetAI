import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function UserDropdown() {
    const { user, logout } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    if (!user) return null;

    return (
        <div className="relative" ref={dropdownRef}>
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full hover:bg-muted text-muted-foreground"
                onClick={() => setIsOpen(!isOpen)}
            >
                <UserIcon className="h-5 w-5" strokeWidth={1.5} />
            </Button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-md border border-border bg-surface-card shadow-lg z-50 py-1 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                    <div className="px-3 py-2 border-b border-border mb-1">
                        <p className="text-sm font-medium text-foreground">{user.username}</p>
                        <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                    </div>

                    <button
                        onClick={logout}
                        className="w-full flex items-center px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors gap-2"
                    >
                        <LogOut className="h-4 w-4" />
                        Log out
                    </button>
                </div>
            )}
        </div>
    );
}
