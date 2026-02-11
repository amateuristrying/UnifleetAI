import { Trophy, Zap, AlertTriangle, CheckCircle, Ban, ArrowRight, ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function DriverScoreLogic() {
    return (
        <div className="flex flex-col h-full bg-surface-main overflow-y-auto">
            <div className="flex flex-col p-6 gap-6 w-full max-w-5xl mx-auto">

                {/* Header */}
                <div className="flex flex-col gap-2 mb-4">
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <ShieldCheck className="h-8 w-8 text-primary" />
                        Driver Score Logic
                    </h1>
                    <p className="text-lg text-muted-foreground">
                        Understanding how the Driver Performance Score is calculated.
                    </p>
                </div>

                {/* The Formula Card */}
                <Card className="border-primary/20 bg-primary/5 shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-2xl">
                            <Trophy className="h-6 w-6 text-primary" />
                            The Formula
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-6 bg-surface-card rounded-xl border shadow-sm">
                            <div className="flex flex-col items-center">
                                <span className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Starting Base</span>
                                <span className="text-5xl font-extrabold text-blue-600">100</span>
                            </div>
                            <ArrowRight className="hidden md:block h-6 w-6 text-muted-foreground" />
                            <div className="flex flex-col items-center">
                                <span className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Penalties</span>
                                <span className="text-4xl font-bold text-red-500">- Deductions</span>
                            </div>
                            <div className="flex flex-col items-center">
                                <span className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Bonuses</span>
                                <span className="text-4xl font-bold text-green-600">+ Additions</span>
                            </div>
                            <ArrowRight className="hidden md:block h-6 w-6 text-muted-foreground" />
                            <div className="flex flex-col items-center">
                                <span className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Final Score</span>
                                <span className="text-5xl font-extrabold text-primary">0 - 100</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Detailed Breakdown Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    {/* Penalties */}
                    <Card className="border-l-4 border-l-red-500 shadow-sm hover:shadow-md transition-shadow">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-red-600">
                                <AlertTriangle className="h-5 w-5" />
                                Penalties (Deductions)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="bg-red-100 p-3 rounded-lg text-red-600">
                                    <Zap className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">Speeding Violations</h3>
                                    <p className="text-muted-foreground mb-2">Any recorded speed violation event.</p>
                                    <Badge variant="destructive" className="text-sm px-3 py-1">-5 Points</Badge>
                                    <span className="text-xs text-muted-foreground ml-2">per violation</span>
                                </div>
                            </div>

                            <div className="h-px bg-border/50" />

                            <div className="flex items-start gap-4">
                                <div className="bg-orange-100 p-3 rounded-lg text-orange-600">
                                    <Clock className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">Excessive Idling</h3>
                                    <p className="text-muted-foreground mb-2">Idling duration exceeding 30 minutes in a single day.</p>
                                    <Badge className="bg-orange-500 hover:bg-orange-600 text-sm px-3 py-1">-2 Points</Badge>
                                    <span className="text-xs text-muted-foreground ml-2">per day</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Bonuses */}
                    <Card className="border-l-4 border-l-green-500 shadow-sm hover:shadow-md transition-shadow">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-green-600">
                                <CheckCircle className="h-5 w-5" />
                                Bonuses (Rewards)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="bg-green-100 p-3 rounded-lg text-green-600">
                                    <Truck className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">Distance Milestone</h3>
                                    <p className="text-muted-foreground mb-2">Driving more than 50km in a single day.</p>
                                    <Badge className="bg-green-600 hover:bg-green-700 text-sm px-3 py-1">+1 Point</Badge>
                                    <span className="text-xs text-muted-foreground ml-2">per day</span>
                                </div>
                            </div>

                            <div className="h-px bg-border/50" />

                            <div className="flex items-start gap-4">
                                <div className="bg-blue-100 p-3 rounded-lg text-blue-600">
                                    <ShieldCheck className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">Perfect Safety Day</h3>
                                    <p className="text-muted-foreground mb-2">Completing a day with ZERO speed violations.</p>
                                    <Badge className="bg-blue-600 hover:bg-blue-700 text-sm px-3 py-1">+2 Points</Badge>
                                    <span className="text-xs text-muted-foreground ml-2">per day</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                </div>

                {/* Additional Rules */}
                <Card className="bg-muted/30">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Ban className="h-5 w-5 text-muted-foreground" />
                            Additional Rules
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-3">
                            <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-300">Sundays</Badge>
                            <span className="text-muted-foreground font-medium">Marked as "No Task Day". Scoring is skipped completely.</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-300">Clamping</Badge>
                            <span className="text-muted-foreground font-medium">The score is strictly clamped. It cannot go above 100 or below 0.</span>
                        </div>
                    </CardContent>
                </Card>

            </div>
        </div>
    );
}

// Simple Icon Components for internal use if Lucide import fails or for custom styling needed
// But we used Lucide imports above.

import { Clock, Truck } from "lucide-react";
