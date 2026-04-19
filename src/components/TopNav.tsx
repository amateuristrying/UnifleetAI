import { useState, useEffect } from "react";
import { Button } from "./ui/button"
import { Plus, LogOut, Sun, Moon, AlertCircle } from "lucide-react"
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useTheme } from "@/context/ThemeProvider"
import unifleetLogo from "@/assets/unifleet_logo.png";
import unifleetLogoDark from "@/assets/unifleet_logo_dark.png";
import { useAuth } from "@/context/AuthContext";
import { UserDropdown } from "./auth/UserDropdown";
import { CreateUserModal } from "./auth/CreateUserModal";

export function TopNav({ isLocked = false }: { isLocked?: boolean }) {
    const { resolved } = useTheme();
    const { logout, checkPermission } = useAuth();
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [lockMessage, setLockMessage] = useState<{ text: string, x: number, y: number } | null>(null);

    const logoSrc = resolved === 'dark' ? unifleetLogoDark : unifleetLogo;
    const isAdmin = checkPermission('admin_only');

    const handleLogout = () => {
        if (isLocked) return;
        logout();
    }

    const showLockMessage = (text: string, e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setLockMessage({
            text,
            x: rect.left + rect.width / 2,
            y: rect.bottom + 10
        });
    };

    useEffect(() => {
        if (lockMessage) {
            const timer = setTimeout(() => setLockMessage(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [lockMessage]);

    return (
        <div className="flex h-[60px] w-full items-center justify-between px-6 pt-2 relative">
            {/* Lock Message Popup */}
            {lockMessage && (
                <div 
                    className="fixed z-[100] bg-surface-card border border-border shadow-xl rounded-xl px-4 py-2 text-xs font-semibold animate-in fade-in zoom-in slide-in-from-top-2 duration-300 flex items-center gap-2 -translate-x-1/2"
                    style={{ left: lockMessage.x, top: lockMessage.y }}
                >
                    <AlertCircle className="h-3.5 w-3.5 text-blue-500" />
                    <span>{lockMessage.text}</span>
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-surface-card border-l border-t border-border rotate-45" />
                </div>
            )}

            {/* Left: Branding */}
            <div className="flex items-center gap-4">
                <div className="flex items-center ml-[-65px] mt-[13px]">
                    <img
                        src={logoSrc}
                        alt="UNIFLEET"
                        className="h-[170px] w-auto object-contain"
                    />
                </div>
            </div>

            {/* Right Group: Links + Actions */}
            <div className="flex items-center gap-4">
                {/* Nav Links */}
                <div className="flex items-center gap-2">
                    <NavItem to="/" label="Home" isLocked={isLocked} onLockClick={(e) => showLockMessage(`User must log in first to see Home`, e)} />
                    <NavItem to="/vehicle/route-master" label="Routes Master" isLocked={isLocked} onLockClick={(e) => showLockMessage(`User must log in first to see Routes Master`, e)} />
                    <NavItem to="/dashboard" label="Dashboard" isLocked={isLocked} onLockClick={(e) => showLockMessage(`User must log in first to see Dashboard`, e)} />
                    <NavItem to="/reports" label="Reports" isLocked={isLocked} onLockClick={(e) => showLockMessage(`User must log in first to see Reports`, e)} />
                    <NavItem to="/fleet-ai" label="Unifleet AI" isLocked={isLocked} onLockClick={(e) => showLockMessage(`User must log in first to see Unifleet AI`, e)} />
                    <NavItem to="/driver-scores" label="Driver Scores" isLocked={isLocked} onLockClick={(e) => showLockMessage(`User must log in first to see Driver Scores`, e)} />
                    <NavItem to="/compliance" label="Compliance" isLocked={isLocked} onLockClick={(e) => showLockMessage(`User must log in first to see Compliance`, e)} />
                </div>

                {/* Vertical Divider */}
                <div className="h-6 w-px bg-border mx-1"></div>

                {/* Action Icons - Floating island */}
                <div className={cn(
                    "flex items-center gap-1 bg-surface-card rounded-full px-3 py-1 shadow-sm border border-border"
                )}>
                    {/* Admin Only: Create User */}
                    {isAdmin && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full hover:bg-muted text-muted-foreground"
                            onClick={() => setIsCreateModalOpen(true)}
                        >
                            <Plus className="h-5 w-5" strokeWidth={1.5} />
                        </Button>
                    )}

                    {/* User Dropdown */}
                    {!isLocked && <UserDropdown />}

                    {/* Exit / Logout Immediate */}
                    {!isLocked && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full hover:bg-muted text-muted-foreground hover:text-destructive"
                            onClick={handleLogout}
                            title="Sign out"
                        >
                            <LogOut className="h-5 w-5" strokeWidth={1.5} />
                        </Button>
                    )}
                </div>
            </div>

            <CreateUserModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
            />
        </div>
    )
}

function NavItem({ 
    to, 
    label, 
    isLocked = false,
    onLockClick
}: { 
    to: string, 
    label: string, 
    isLocked?: boolean,
    onLockClick?: (e: React.MouseEvent) => void
}) {
    const handleNavItemClick = (e: React.MouseEvent) => {
        if (isLocked) {
            e.preventDefault();
            onLockClick?.(e);
        }
    }

    return (
        <NavLink
            to={to}
            onClick={handleNavItemClick}
            className={({ isActive }) =>
                cn(
                    "h-8 rounded-full px-3 text-sm font-medium transition-colors flex items-center justify-center",
                    isActive && !isLocked
                        ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 px-4"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    isLocked && "cursor-default"
                )
            }
        >
            {label}
        </NavLink>
    )
}
