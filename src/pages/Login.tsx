import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Animated Logo Component
function UnifleetLogo({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 160 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn("group cursor-default", className)} // Added group for hover effects
            aria-label="Unifleet Logo"
        >
            <g transform="translate(0, 0)">
                {/* The Icon: Adds a smooth 'lift' animation on hover */}
                <g className="transition-transform duration-500 ease-out group-hover:-translate-y-1.5">
                    <path
                        d="M10 24 A 14 14 0 0 1 38 24"
                        stroke="currentColor"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                    />
                    <path
                        d="M24 18 L 24 32"
                        stroke="currentColor"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                    />
                </g>

                {/* The Text: Subtle opacity change on hover */}
                <text
                    x="50"
                    y="32"
                    fill="currentColor"
                    fontSize="26"
                    fontWeight="600"
                    fontFamily="Lexend, sans-serif"
                    style={{ letterSpacing: '-0.03em' }}
                    className="transition-opacity duration-300 group-hover:opacity-80"
                >
                    unifleet
                </text>
            </g>
        </svg>
    );
}

export function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { login, isLoading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const from = location.state?.from?.pathname || '/dashboard';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            await login({ username, password });
            navigate(from, { replace: true });
        } catch (err: any) {
            setError(err.message || 'Invalid credentials');
        }
    };

    return (
        <div className="flex min-h-screen w-full items-center justify-center bg-surface-main p-4">
            <Card className="w-full max-w-[420px] shadow-xl border-border bg-surface-card transition-all duration-300 hover:shadow-2xl">

                <CardHeader className="flex flex-col items-center gap-6 pt-10 pb-4">
                    <UnifleetLogo className="h-10 w-auto text-foreground" />

                    <div className="text-center space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-700">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">
                            Welcome back
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Enter your credentials to access your account
                        </p>
                    </div>
                </CardHeader>

                <CardContent className="px-8 pb-10">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-2 group">
                            <Input
                                type="text"
                                placeholder="Username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                disabled={isLoading}
                                className="h-12 bg-background/50 transition-all duration-200 focus:scale-[1.01] focus:bg-background"
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <Input
                                type="password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={isLoading}
                                className="h-12 bg-background/50 transition-all duration-200 focus:scale-[1.01] focus:bg-background"
                            />
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20 animate-in zoom-in-95 duration-200">
                                <AlertCircle className="h-4 w-4" />
                                <span>{error}</span>
                            </div>
                        )}

                        <Button
                            type="submit"
                            className="
                                w-full h-12 text-base font-medium 
                                shadow-md transition-all duration-200 
                                hover:scale-[1.02] hover:shadow-lg hover:bg-primary/90
                                active:scale-[0.98] active:shadow-sm
                            "
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Signing in...
                                </>
                            ) : (
                                "Sign in"
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}