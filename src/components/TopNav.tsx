import { Button } from "./ui/button"
import { Plus, LogOut, Sun, Moon } from "lucide-react"
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
// import { useOnlineStatus } from "@/hooks/useVehiclesDB" // Unused now
import { useTheme } from "@/context/ThemeProvider"

import unifleetLogo from "@/assets/unifleet_logo.png";
import unifleetLogoDark from "@/assets/unifleet_logo_dark.png";

import { useAuth } from "@/context/AuthContext";
import { UserDropdown } from "./auth/UserDropdown";
import { CreateUserModal } from "./auth/CreateUserModal";
import { useState } from "react";

export function TopNav() {
    const { resolved, setTheme } = useTheme();

    // Auth Hooks
    const { logout, checkPermission } = useAuth();
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const logoSrc = resolved === 'dark' ? unifleetLogoDark : unifleetLogo;
    const isAdmin = checkPermission('admin_only');

    const toggleTheme = () => setTheme(resolved === 'dark' ? 'light' : 'dark');

    return (
        <div className="flex h-[60px] w-full items-center justify-between px-6 pt-2">
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
                    <NavItem to="/" label="Home" />
                    <NavItem to="/vehicle/route-master" label="Routes Master" />
                    <NavItem to="/dashboard" label="Dashboard" />
                    <NavItem to="/reports" label="Reports" />
                    <NavItem to="/fleet-ai" label="Unifleet AI" />
                    <NavItem to="/vehicle/score-logic" label="Driver Scores" />
                    <NavItem to="/compliance" label="Compliance" />
                </div>

                {/* Vertical Divider */}
                <div className="h-6 w-px bg-border mx-1"></div>

                {/* Action Icons - Floating island */}
                <div className="flex items-center gap-1 bg-surface-card rounded-full px-3 py-1 shadow-sm border border-border">
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
                    <UserDropdown />

                    {/* Exit / Logout Immediate */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full hover:bg-muted text-muted-foreground hover:text-destructive"
                        onClick={logout}
                        title="Sign out"
                    >
                        <LogOut className="h-5 w-5" strokeWidth={1.5} />
                    </Button>

                    {/* Dark / Light toggle */}
                    <div className="h-5 w-px bg-border mx-0.5"></div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full hover:bg-muted text-muted-foreground"
                        onClick={toggleTheme}
                        title={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        {resolved === 'dark'
                            ? <Sun className="h-5 w-5" strokeWidth={1.5} />
                            : <Moon className="h-5 w-5" strokeWidth={1.5} />
                        }
                    </Button>
                </div>
            </div>

            <CreateUserModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
            />
        </div>
    )
}

function NavItem({ to, label }: { to: string, label: string }) {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                cn(
                    "h-8 rounded-full px-3 text-sm font-medium transition-colors flex items-center justify-center",
                    isActive
                        ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 px-4"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )
            }
        >
            {label}
        </NavLink>
    )
}
