import { useRef, useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

import { SummaryMetricsDashboard } from "@/components/dashboards/SummaryMetricsDashboard";
import { DailyAssetsActiveDashboard } from "@/components/dashboards/DailyAssetsActiveDashboard";
import { MovementIdlingDashboard } from "@/components/dashboards/MovementIdlingDashboard";
import { FuelExpenseDashboard } from "@/components/dashboards/FuelExpenseDashboard";
import { NightDriversDashboard } from "@/components/dashboards/NightDriversDashboard";
import { SpeedViolationsDashboard } from "@/components/dashboards/SpeedViolationsDashboard";
import { GeofenceDashboard } from "@/components/dashboards/GeofenceDashboard";

import { useOps } from "@/context/OpsContext";
import { useTheme } from "@/context/ThemeProvider";
import logoLight from "@/assets/unifleet_logo.png";
import logoDark from "@/assets/unifleet_logo_dark.png";

type TF = "1 day" | "7 days" | "30 days";

const OPS_LABEL: Record<"zambia" | "tanzania", string> = {
    zambia: "Zambian Ops",
    tanzania: "Tanzanian Ops",
};

// Section titles for PDF
const SECTION_TITLES = [
    "Summary Metrics",
    "Daily Assets Active",
    "Movement vs Idling",
    "Fuel Expense",
    "Night Drivers",
    "Speed Violations",
    "Geofence Status",
];

export function Dashboard() {
    const sectionsRootRef = useRef<HTMLDivElement>(null);
    const { ops, setOps } = useOps();
    const { resolved } = useTheme();
    const location = useLocation();
    const { checkPermission } = useAuth();
    const isAdmin = checkPermission('admin_only');

    const [isDownloading, setIsDownloading] = useState(false);

    // Track which dashboard sections are still loading
    const [sectionsLoading, setSectionsLoading] = useState<Set<string>>(new Set([
        'summary', 'dailyAssets', 'movementIdling', 'fuelExpense',
        'nightDrivers', 'speedViolations', 'geofence',
    ]));
    const allSettled = sectionsLoading.size === 0;
    const canDownload = allSettled && !isDownloading;

    // Stable callbacks for each section
    const makeSectionLoadingCb = useCallback((key: string) => {
        return (loading: boolean) => {
            setSectionsLoading(prev => {
                const next = new Set(prev);
                if (loading) next.add(key); else next.delete(key);
                // Only return new set if actually changed
                if (next.size === prev.size && [...next].every(k => prev.has(k))) return prev;
                return next;
            });
        };
    }, []);
    const onSummaryLoading = useCallback(makeSectionLoadingCb('summary'), [makeSectionLoadingCb]);
    const onDailyAssetsLoading = useCallback(makeSectionLoadingCb('dailyAssets'), [makeSectionLoadingCb]);
    const onMovementLoading = useCallback(makeSectionLoadingCb('movementIdling'), [makeSectionLoadingCb]);
    const onFuelLoading = useCallback(makeSectionLoadingCb('fuelExpense'), [makeSectionLoadingCb]);
    const onNightLoading = useCallback(makeSectionLoadingCb('nightDrivers'), [makeSectionLoadingCb]);
    const onSpeedLoading = useCallback(makeSectionLoadingCb('speedViolations'), [makeSectionLoadingCb]);
    const onGeofenceLoading = useCallback(makeSectionLoadingCb('geofence'), [makeSectionLoadingCb]);

    const [summaryFilter, setSummaryFilter] = useState<TF>("30 days");
    const [nightFilter, setNightFilter] = useState<TF>("30 days");
    const [speedFilter, setSpeedFilter] = useState<TF>("30 days");
    const [commonFilter, setCommonFilter] = useState<TF>("30 days");

    // Handle ?df=1d|7d|30d from URL
    useEffect(() => {
        const df = (new URLSearchParams(location.search).get("df") || "").toLowerCase();
        if (df === "1d") {
            setSummaryFilter("1 day");
            setNightFilter("1 day");
            setSpeedFilter("1 day");
        } else if (df === "30d") {
            setSummaryFilter("30 days");
            setNightFilter("30 days");
            setSpeedFilter("30 days");
            setCommonFilter("30 days");
        } else if (df === "7d") {
            setSummaryFilter("7 days");
        }
    }, [location.search]);

    const handleSummarySet = (next: string) => {
        const nx = (next as TF) || "30 days";
        setSummaryFilter(nx);
        if (nx === "1 day") {
            setNightFilter("1 day");
            setSpeedFilter("1 day");
        } else if (nx === "30 days") {
            setNightFilter("30 days");
            setSpeedFilter("30 days");
        }
    };

    // Download PDF with dynamic page heights per section
    const handleDownloadPdf = async () => {
        setIsDownloading(true);

        try {
            const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
                import("html2canvas"),
                import("jspdf"),
            ]);

            const root = sectionsRootRef.current;
            if (!root) {
                setIsDownloading(false);
                return;
            }

            const sections = Array.from(root.querySelectorAll<HTMLElement>(".pdf-section"));
            if (!sections.length) {
                setIsDownloading(false);
                return;
            }

            // Determine theme colors
            const isDark = resolved === 'dark';
            const bgColor = isDark ? [31, 41, 55] : [255, 255, 255]; // Gray-800 or White
            const textColor = isDark ? [249, 250, 251] : [31, 41, 55]; // Gray-50 or Gray-800
            const secondaryColor = isDark ? [156, 163, 175] : [107, 114, 128]; // Gray-400 or Gray-500
            const lineColor = isDark ? [75, 85, 99] : [229, 231, 235]; // Gray-600 or Gray-200
            const logoToUse = isDark ? logoDark : logoLight;

            // A4 landscape width in mm
            const pageW = 297;
            const margin = 15;
            const titleHeight = 14;
            const contentWidth = pageW - margin * 2;

            // Create PDF - we'll set dimensions per page
            let pdf: InstanceType<typeof jsPDF> | null = null;

            // ─── Cover Page (dynamic height) ───
            const coverW = 297; // A4 landscape width

            // ── Contents entries ──
            const coverItems = [
                ["Summary Metrics", "Snapshot of key KPIs (trips, distance, hours, fuel, violations)."],
                ["Daily Assets Active", "Active vehicles per day vs. total fleet to see utilization trends."],
                ["Movement vs. Idling", "Time split between moving and idling to highlight wasted hours."],
                ["Fuel Expense", "Motion vs. idle fuel spend over time; totals highlight cost drivers."],
                ["Night Drivers", "Vehicles with night driving hours and daily totals (after hours activity)."],
                ["Speed Violations", "Counts and ranking of speeding events by vehicle/day (risk focus)."],
                ["Geofence", "Entries/exits and dwell insights for zones (route & site compliance)."],
            ];

            // ── Pre-calculate height ──
            const itemSpacing = 8;
            const estimatedContentH = 30 + 40 /*logo*/ + 15 /*title*/ + 10 /*subtitle*/ + 10 /*divider*/ + 15 /*heading*/ + (coverItems.length * itemSpacing) + 20;
            const coverH = Math.max(estimatedContentH, 210);

            pdf = new jsPDF({
                orientation: "landscape",
                unit: "mm",
                format: [coverW, coverH],
            });

            // Background
            pdf.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
            pdf.rect(0, 0, coverW, coverH, "F");

            // ── Logo (Top Left) ──
            const logoMarginX = 5; // <--- Customize Logo X Margin Here
            const logoMarginY = 7; // <--- Customize Logo Y Margin Here

            try {
                const logoImg = new Image();
                logoImg.src = logoToUse;
                await new Promise<void>((res, rej) => {
                    logoImg.onload = () => res();
                    logoImg.onerror = () => rej();
                    if (logoImg.complete) res();
                });

                const logoW = 45;
                const ratio = logoImg.naturalHeight / logoImg.naturalWidth;
                const logoH = logoW * ratio;

                pdf.addImage(logoToUse, "PNG", logoMarginX, logoMarginY, logoW, logoH);
            } catch {
                // skip logo silently
            }

            // ── Title ──
            // Left align title relative to page
            let cursorY = 75; // Moved down by 20mm

            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(28);
            pdf.setTextColor(textColor[0], textColor[1], textColor[2]);
            pdf.text("Operations Overview Report", margin, cursorY);

            // ── Subtitle (dynamic timeframe) ──
            cursorY += 10;
            const subtitleMap: Record<string, string> = {
                "1 day": "Last 1 Day",
                "7 days": "Last 7 Days",
                "30 days": "Last 30 Days",
            };
            const subtitleText = `(${subtitleMap[summaryFilter] || "Last 30 Days"})`;
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(14);
            pdf.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
            pdf.text(subtitleText, margin, cursorY);

            // ── Divider line ──
            cursorY += 12;
            pdf.setDrawColor(lineColor[0], lineColor[1], lineColor[2]);
            pdf.setLineWidth(0.3);
            pdf.line(margin, cursorY, coverW - margin, cursorY);

            // ── "CONTENTS" heading ──
            cursorY += 15;
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(14);
            pdf.setTextColor(textColor[0], textColor[1], textColor[2]);
            pdf.text("Contents-", margin, cursorY); // Left aligned

            cursorY += 10;

            // ── Render content entries (Left aligned, normal text) ──
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(11);
            pdf.setTextColor(textColor[0], textColor[1], textColor[2]);

            for (const [label, desc] of coverItems) {
                const text = `${label} - ${desc}`;
                pdf.text(text, margin, cursorY);
                cursorY += itemSpacing;
            }

            // ─── Section Pages ───

            for (let i = 0; i < sections.length; i++) {
                const target = sections[i];
                const contentEl = target.querySelector<HTMLElement>(".pdf-content") || target;

                const canvas = await html2canvas(contentEl, {
                    scale: 2,
                    backgroundColor: isDark ? "#1f2937" : "#ffffff",
                    useCORS: true,
                    scrollY: -window.scrollY,
                    logging: false,
                    ignoreElements: (el) => {
                        if (el.hasAttribute("data-pdf-hide")) return true;
                        if (el.classList?.contains("pdf-hide")) return true;
                        return false;
                    },
                    onclone: (clonedDoc) => {
                        const headerBoxes = clonedDoc.querySelectorAll("[data-pdf-hide], .pdf-hide");
                        headerBoxes.forEach((el) => el.remove());

                        // Fix invisible text color if any
                        const allText = clonedDoc.querySelectorAll("h2, h3, h4, h5, p, span, td, th, div");
                        allText.forEach((el) => {
                            const htmlEl = el as HTMLElement;
                            const style = window.getComputedStyle(el);
                            if (style.color === "rgba(0, 0, 0, 0)" || style.opacity === "0") {
                                htmlEl.style.color = isDark ? "#f3f4f6" : "#1f2937";
                                htmlEl.style.opacity = "1";
                            }
                        });

                        const pdfContent = clonedDoc.querySelector(".pdf-content") as HTMLElement;
                        if (pdfContent) {
                            pdfContent.style.padding = "12px";
                        }
                    },
                });

                // Calculate output dimensions
                const scale = contentWidth / canvas.width;
                const outW = contentWidth;
                const outH = canvas.height * scale;

                // Calculate page height
                const pageH = outH + margin * 2 + titleHeight + 4;

                // Add Page
                if (i === 0) {
                    pdf!.addPage([pageW, pageH], "landscape");
                } else {
                    pdf!.addPage([pageW, pageH], "landscape");
                }

                // Fill Background
                pdf!.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
                pdf!.rect(0, 0, pageW, pageH, "F");

                // Section Title
                const title = SECTION_TITLES[i] || `Section ${i + 1}`;
                pdf!.setFont("helvetica", "bold");
                pdf!.setFontSize(12);
                pdf!.setTextColor(textColor[0], textColor[1], textColor[2]);
                pdf!.text(title.toUpperCase(), margin, margin + 7);

                // Line under title
                pdf!.setDrawColor(lineColor[0], lineColor[1], lineColor[2]);
                pdf!.setLineWidth(0.3);
                pdf!.line(margin, margin + 10, pageW - margin, margin + 10);

                // Content Image
                const img = canvas.toDataURL("image/png");
                pdf!.addImage(img, "PNG", margin, margin + titleHeight, outW, outH, undefined, "FAST");
            }

            if (pdf) {
                const dateStr = new Date().toISOString().slice(0, 10);
                pdf.save(`Operations_Dashboard_${OPS_LABEL[ops].replace(" ", "")}_${dateStr}.pdf`);
            }
        } catch (err) {
            console.error("PDF generation failed:", err);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="flex flex-1 flex-col overflow-hidden h-full">
            <header className="sticky top-0 z-30 px-6 py-4 bg-surface-main">
                <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">
                                Operations Overview
                            </h1>
                            <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                                {OPS_LABEL[ops]}
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Real-time fleet monitoring and analytics
                        </p>
                    </div>

                    {/* Right Side: PDF + Ops Toggle */}
                    <div className="flex flex-col items-end gap-2">
                        {/* Download PDF Button */}
                        <div className="relative group">
                            <button
                                id="download-pdf-btn"
                                onClick={handleDownloadPdf}
                                disabled={!canDownload}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm transition-all",
                                    !canDownload
                                        ? "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
                                        : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                                )}
                            >
                                {isDownloading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Generating PDF...
                                    </>
                                ) : !allSettled ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Loading...
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-4 w-4" />
                                        Download PDF
                                    </>
                                )}
                            </button>
                            {/* Tooltip on hover when disabled */}
                            {!canDownload && !isDownloading && (
                                <div className="absolute right-0 top-full mt-2 z-50 hidden group-hover:block">
                                    <div className="bg-slate-900 dark:bg-slate-700 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg whitespace-nowrap">
                                        Dashboards are still settling down. Please wait!
                                        <div className="absolute -top-1 right-4 w-2 h-2 bg-slate-900 dark:bg-slate-700 rotate-45" />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Ops Toggle Switch */}
                        <div className={cn(
                            "flex items-center bg-muted/60 rounded-full p-0.5 border border-border shadow-sm transition-opacity",
                            !isAdmin && "opacity-60 pointer-events-none grayscale"
                        )}>
                            <button
                                onClick={() => isAdmin && setOps('tanzania')}
                                disabled={!isAdmin}
                                className={cn(
                                    "px-3 py-1 text-[11px] font-medium rounded-full transition-all duration-200 cursor-pointer",
                                    !isAdmin && "cursor-not-allowed",
                                    ops === 'tanzania'
                                        ? "bg-blue-500 text-white shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                TZ Ops
                            </button>
                            <button
                                onClick={() => isAdmin && setOps('zambia')}
                                disabled={!isAdmin}
                                className={cn(
                                    "px-3 py-1 text-[11px] font-medium rounded-full transition-all duration-200 cursor-pointer",
                                    !isAdmin && "cursor-not-allowed",
                                    ops === 'zambia'
                                        ? "bg-blue-500 text-white shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                ZM Ops
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-auto px-6 py-4">
                <div key={ops} ref={sectionsRootRef} className="space-y-6">
                    <section className="pdf-section">
                        <SummaryMetricsDashboard
                            dateFilter={summaryFilter}
                            setDateFilter={handleSummarySet}
                            onLoadingChange={onSummaryLoading}
                        />
                    </section>

                    <section className="pdf-section">
                        <DailyAssetsActiveDashboard
                            dateFilter={commonFilter}
                            setDateFilter={(v: string) =>
                                setCommonFilter((v as TF) || "30 days")
                            }
                            onLoadingChange={onDailyAssetsLoading}
                        />
                    </section>

                    <section className="pdf-section">
                        <MovementIdlingDashboard
                            dateFilter={commonFilter}
                            setDateFilter={(v: string) =>
                                setCommonFilter((v as TF) || "30 days")
                            }
                            onLoadingChange={onMovementLoading}
                        />
                    </section>

                    <section className="pdf-section">
                        <FuelExpenseDashboard
                            dateFilter={commonFilter}
                            setDateFilter={(v: string) =>
                                setCommonFilter((v as TF) || "30 days")
                            }
                            onLoadingChange={onFuelLoading}
                        />
                    </section>

                    <section className="pdf-section">
                        <NightDriversDashboard
                            dateFilter={nightFilter}
                            setDateFilter={(v: string) =>
                                setNightFilter((v as TF) || "30 days")
                            }
                            onLoadingChange={onNightLoading}
                        />
                    </section>

                    <section className="pdf-section">
                        <SpeedViolationsDashboard
                            dateFilter={speedFilter}
                            setDateFilter={(v: string) =>
                                setSpeedFilter((v as TF) || "30 days")
                            }
                            onLoadingChange={onSpeedLoading}
                        />
                    </section>

                    <section className="pdf-section">
                        <GeofenceDashboard onLoadingChange={onGeofenceLoading} />
                    </section>
                </div>
            </main>
        </div>
    );
}
