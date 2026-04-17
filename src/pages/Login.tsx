import { useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import unifleetLogo from "@/assets/unifleet_logo.png";
import unifleetLogoDark from "@/assets/unifleet_logo_dark.png";
import { useTheme } from "@/context/ThemeProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";


/* ─── Feature Highlights for the top info strip ─── */
const FEATURES = [
    { label: 'Live Tracking', color: '#22C55E' },
    { label: 'Dashboards', color: '#3B82F6' },
    { label: 'Reports', color: '#EAB308' },
    { label: 'Fleet Health', color: '#A855F7' },
];

export function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isTransitioning, setIsTransitioning] = useState(false);
    const { login, isLoading } = useAuth();
    const { resolved } = useTheme();
    const navigate = useNavigate();
    const location = useLocation();

    // Determine the route to go back to after login
    const from = location.state?.from?.pathname || '/';

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            await login({ username, password });
            setIsTransitioning(true);
            setTimeout(() => {
                navigate(from, { replace: true });
            }, 600);
        } catch (err: any) {
            setError(err.message || 'Invalid credentials');
        }
    }, [username, password, login, from, navigate]);

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-surface-main font-sans text-foreground transition-colors duration-200">
            {/* ═══════════ REAL SIDEBAR (Locked) ═══════════ */}
            <Sidebar isLocked={true} />

            {/* ═══════════ Main Wrapping Content ═══════════ */}
            <div className="flex flex-1 flex-col overflow-hidden">
                
                {/* ═══════════ REAL TOP NAV (Locked) ═══════════ */}
                <TopNav isLocked={true} />

                {/* ═══════════ Login Content Area (Matches Home layout) ═══════════ */}
                <div className="flex flex-1 flex-col overflow-hidden h-full">
                    
                    {/* Horizontal Box (Replaces StatusPanel) */}
                    <section className={cn(
                        "sticky top-[10px] z-30 bg-surface-main px-6 pb-2 -mt-5 transition-all duration-700 ease-in-out",
                        isTransitioning ? "opacity-0 translate-y-[-10px]" : "opacity-100 translate-y-0"
                    )}>
                        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between w-full bg-surface-card rounded-[20px] px-6 py-4 shadow-sm border border-border min-h-[88px] gap-4">
                            <div className="flex flex-col flex-1">
                                <h1 className="text-xl font-black tracking-tighter text-foreground uppercase">
                                    UNIFLEET X ASAS OPERATIONS INTERFACE
                                </h1>
                                <p className="text-[13px] font-medium text-muted-foreground mt-1">
                                    A simple and easy to navigate platform to manage your fleet. Precision tracking for Tanzania's logistics leaders.
                                </p>
                            </div>
                            
                            <div className="flex items-center gap-x-6 gap-y-2 flex-wrap justify-end">
                                {FEATURES.map(({ label, color }) => (
                                    <div key={label} className="flex items-center gap-2">
                                        <div 
                                            className="w-1.5 h-1.5 rounded-full shrink-0" 
                                            style={{ backgroundColor: color }}
                                        />
                                        <span className="text-[12px] font-semibold text-foreground/80 lowercase first-letter:uppercase">
                                            {label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* Main Below-Panels Content */}
                    <main className="flex-1 overflow-hidden px-6 pt-8 pb-3 flex gap-4">
                        
                        {/* Vertical Box (Login Form) */}
                        <div className={cn(
                            "flex w-[400px] min-w-[350px] flex-col h-full gap-4 transition-all duration-700 ease-in-out",
                            isTransitioning ? "opacity-0 translate-x-[-10px]" : "opacity-100 translate-x-0"
                        )}>
                            <div className="bg-surface-card rounded-[30px] border border-border shadow-xl flex flex-col h-full overflow-hidden">
                                
                                {/* Header (Logo & Welcome) */}
                                <div className="p-6 pb-4 flex flex-col items-center border-b border-border/50">
                                    <img
                                        src={resolved === 'dark' ? unifleetLogoDark : unifleetLogo}
                                        alt="UNIFLEET"
                                        className="h-[120px] w-auto object-contain mb-[-30px] mt-[-30px]"
                                    />
                                    <h3 className="font-bold text-foreground mt-4 text-center text-lg">System Access</h3>
                                    <p className="text-xs text-muted-foreground mt-1 text-center">
                                        Authenticate to unlock fleet control
                                    </p>
                                </div>
                                
                                {/* Form Section */}
                                <div className="flex-1 p-6 flex flex-col pt-8">
                                    <form onSubmit={handleSubmit} className="space-y-5">
                                        <div className="space-y-1.5">
                                            <Input
                                                type="text"
                                                placeholder="Username"
                                                value={username}
                                                onChange={(e) => setUsername(e.target.value)}
                                                disabled={isLoading || isTransitioning}
                                                className="h-12 rounded-xl bg-background/50 transition-all duration-200 focus:bg-background"
                                                autoFocus
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Input
                                                type="password"
                                                placeholder="Password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                disabled={isLoading || isTransitioning}
                                                className="h-12 rounded-xl bg-background/50 transition-all duration-200 focus:bg-background"
                                            />
                                        </div>

                                        {error && (
                                            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-xl border border-destructive/20 animate-in zoom-in-95 duration-200 mt-2">
                                                <AlertCircle className="h-4 w-4 shrink-0" />
                                                <span>{error}</span>
                                            </div>
                                        )}

                                        <Button
                                            type="submit"
                                            className="w-full h-12 text-[14px] font-semibold rounded-xl shadow-md transition-all duration-200 hover:scale-[1.02] mt-2 active:scale-95"
                                            disabled={isLoading || isTransitioning}
                                        >
                                            {isLoading || isTransitioning ? (
                                                <span className="flex items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    {isTransitioning ? 'Unlocking...' : 'Signing in...'}
                                                </span>
                                            ) : (
                                                "Sign in"
                                            )}
                                        </Button>
                                    </form>
                                    
                                    <div className="mt-auto pt-6 pb-2 text-center">
                                        <p className="text-[10px] font-medium tracking-widest text-muted-foreground/60 uppercase">
                                            Unifleet Platform
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Video Panel (Right Panel) */}
                        <div className={cn(
                            "flex-1 h-full rounded-[24px] overflow-hidden shadow-lg border border-border relative bg-black transition-all duration-700 ease-in-out",
                            isTransitioning ? "opacity-100" : "opacity-95"
                        )}>
                            {/* Original Video Playback */}
                            <video 
                                src="/assets/login_video.mp4" 
                                autoPlay 
                                loop 
                                muted 
                                playsInline
                                className="absolute inset-0 w-full h-full object-cover"
                            />
                            
                            <div 
                                className="absolute inset-0 z-20 transition-opacity duration-700" 
                                style={{ opacity: isTransitioning ? 0 : 1 }}
                            />
                        </div>
                    </main>

                </div>
            </div>
        </div>
    );
}