import { useRef, useState, useEffect } from "react";
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
import unifleetLogo from "@/assets/logo1.png";

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
    const location = useLocation();
    const { checkPermission } = useAuth();
    const isAdmin = checkPermission('admin_only');

    const [isDownloading, setIsDownloading] = useState(false);

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

            // A4 landscape width in mm (we'll use this as fixed width, height will vary)
            const pageW = 297; // A4 landscape width
            const margin = 8;
            const titleHeight = 14;
            const contentWidth = pageW - margin * 2;

            // Create PDF - we'll set dimensions per page
            let pdf: InstanceType<typeof jsPDF> | null = null;

            // ─── Cover Page (dynamic height) ───
            const coverW = 297; // A4 landscape width

            // We'll calculate content first, then set the page height
            const centerX = coverW / 2;

            // ── Contents entries (pre-compute for centering) ──
            const coverItems = [
                ["Summary Metrics", "Snapshot of key KPIs (trips, distance, hours, fuel, violations)."],
                ["Daily Assets Active", "Active vehicles per day vs. total fleet to see utilization trends."],
                ["Movement vs. Idling", "Time split between moving and idling to highlight wasted hours."],
                ["Fuel Expense", "Motion vs. idle fuel spend over time; totals highlight cost drivers."],
                ["Night Drivers", "Vehicles with night driving hours and daily totals (after hours activity)."],
                ["Speed Violations", "Counts and ranking of speeding events by vehicle/day (risk focus)."],
                ["Geofence", "Entries/exits and dwell insights for zones (route & site compliance)."],
            ];

            // ── Pre-calculate total content height so we can set dynamic page height ──
            // Logo ~55mm wide, aspect ratio dependent height, ~10mm margin
            // Title ~10mm, subtitle ~5mm, gap ~8.5mm, divider, heading, entries
            const itemSpacing = 7;
            const estimatedContentH = 30 /*top*/ + 55 /*logo area*/ + 10 /*gap*/ + 10 /*title*/ + 9 /*subtitle*/ + 8.5 /*divider gap*/ + 10 /*content heading*/ + 8 /*gap*/ + (coverItems.length * itemSpacing) + 15 /*bottom padding*/;
            const coverH = Math.max(estimatedContentH, 140); // minimum 140mm

            pdf = new jsPDF({
                orientation: "landscape",
                unit: "mm",
                format: [coverW, coverH],
            });

            // White background
            pdf.setFillColor(255, 255, 255);
            pdf.rect(0, 0, coverW, coverH, "F");

            // ── Logo (centered, 55mm wide) ──
            let logoBottomY = 40; // fallback if logo fails
            try {
                const logoImg = new Image();
                logoImg.src = unifleetLogo;
                await new Promise<void>((res, rej) => {
                    logoImg.onload = () => res();
                    logoImg.onerror = () => rej();
                    if (logoImg.complete) res();
                });

                const logoW = 55;
                const ratio = logoImg.naturalHeight / logoImg.naturalWidth;
                const logoH = logoW * ratio;
                const logoX = centerX - logoW / 2;
                const logoY = 30;
                pdf.addImage(unifleetLogo, "PNG", logoX, logoY, logoW, logoH);
                logoBottomY = logoY + logoH + 10;
            } catch {
                // skip logo silently
            }

            // ── Title ──
            let cursorY = logoBottomY;
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(30);
            pdf.setTextColor(31, 41, 55);
            pdf.text("Operations Overview Report", centerX, cursorY, { align: "center" });

            // ── Subtitle (dynamic timeframe) ──
            cursorY += 9;
            const subtitleMap: Record<string, string> = {
                "1 day": "Last 1 Day",
                "7 days": "Last 7 Days",
                "30 days": "Last 30 Days",
            };
            const subtitleText = `(${subtitleMap[summaryFilter] || "Last 30 Days"})`;
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(15);
            pdf.setTextColor(107, 114, 128);
            pdf.text(subtitleText, centerX, cursorY, { align: "center" });

            // ── Divider line ──
            cursorY += 8.5;
            pdf.setDrawColor(229, 231, 235);
            pdf.setLineWidth(0.3);
            const lineInset = 30;
            pdf.line(lineInset, cursorY, coverW - lineInset, cursorY);

            // ── "CONTENT" heading ──
            cursorY += 10;
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(14);
            pdf.setTextColor(31, 41, 55);
            pdf.text("CONTENTS", centerX, cursorY, { align: "center" });

            cursorY += 8;

            // ── Render content entries (centered) ──
            pdf.setFontSize(10);
            for (const [label, desc] of coverItems) {
                // Measure full line width to center it
                pdf.setFont("helvetica", "bold");
                const boldPart = `${label} - `;
                const boldW = pdf.getTextWidth(boldPart);
                pdf.setFont("helvetica", "normal");
                const normalW = pdf.getTextWidth(desc);
                const totalW = boldW + normalW;
                const startX = centerX - totalW / 2;

                pdf.setFont("helvetica", "bold");
                pdf.setTextColor(31, 41, 55);
                pdf.text(boldPart, startX, cursorY);

                pdf.setFont("helvetica", "normal");
                pdf.setTextColor(107, 114, 128);
                pdf.text(desc, startX + boldW, cursorY);

                cursorY += itemSpacing;
            }

            // ─── Section Pages ───

            for (let i = 0; i < sections.length; i++) {
                const target = sections[i];
                const contentEl = target.querySelector<HTMLElement>(".pdf-content") || target;

                const canvas = await html2canvas(contentEl, {
                    scale: 2,
                    backgroundColor: "#ffffff",
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

                        const allText = clonedDoc.querySelectorAll("h2, h3, h4, h5, p, span, td, th, div");
                        allText.forEach((el) => {
                            const htmlEl = el as HTMLElement;
                            const style = window.getComputedStyle(el);
                            if (style.color === "rgba(0, 0, 0, 0)" || style.opacity === "0") {
                                htmlEl.style.color = "#1f2937";
                                htmlEl.style.opacity = "1";
                            }
                        });

                        const pdfContent = clonedDoc.querySelector(".pdf-content") as HTMLElement;
                        if (pdfContent) {
                            pdfContent.style.padding = "12px";
                        }
                    },
                });

                // Calculate output dimensions - fit to content width
                const scale = contentWidth / canvas.width;
                const outW = contentWidth;
                const outH = canvas.height * scale;

                // Calculate page height based on content (add margins and title)
                const pageH = outH + margin * 2 + titleHeight + 4; // +4 for a bit of bottom padding

                if (i === 0) {
                    // First data page — add to existing PDF (cover was page 1)
                    pdf!.addPage([pageW, pageH], "landscape");
                } else {
                    // Add a new page with custom dimensions for this section
                    pdf!.addPage([pageW, pageH], "landscape");
                }

                // Add section title
                const title = SECTION_TITLES[i] || `Section ${i + 1}`;
                pdf!.setFont("helvetica", "bold");
                pdf!.setFontSize(12);
                pdf!.setTextColor(31, 41, 55);
                pdf!.text(title.toUpperCase(), margin, margin + 7);

                // Add a subtle line under title
                pdf!.setDrawColor(200, 200, 200);
                pdf!.setLineWidth(0.3);
                pdf!.line(margin, margin + 10, pageW - margin, margin + 10);

                // Add the content image
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
                        <button
                            onClick={handleDownloadPdf}
                            disabled={isDownloading}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm transition-all",
                                isDownloading
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                            )}
                        >
                            {isDownloading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Generating PDF...
                                </>
                            ) : (
                                <>
                                    <Download className="h-4 w-4" />
                                    Download PDF
                                </>
                            )}
                        </button>

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
                        />
                    </section>

                    <section className="pdf-section">
                        <DailyAssetsActiveDashboard
                            dateFilter={commonFilter}
                            setDateFilter={(v: string) =>
                                setCommonFilter((v as TF) || "30 days")
                            }
                        />
                    </section>

                    <section className="pdf-section">
                        <MovementIdlingDashboard
                            dateFilter={commonFilter}
                            setDateFilter={(v: string) =>
                                setCommonFilter((v as TF) || "30 days")
                            }
                        />
                    </section>

                    <section className="pdf-section">
                        <FuelExpenseDashboard
                            dateFilter={commonFilter}
                            setDateFilter={(v: string) =>
                                setCommonFilter((v as TF) || "30 days")
                            }
                        />
                    </section>

                    <section className="pdf-section">
                        <NightDriversDashboard
                            dateFilter={nightFilter}
                            setDateFilter={(v: string) =>
                                setNightFilter((v as TF) || "30 days")
                            }
                        />
                    </section>

                    <section className="pdf-section">
                        <SpeedViolationsDashboard
                            dateFilter={speedFilter}
                            setDateFilter={(v: string) =>
                                setSpeedFilter((v as TF) || "30 days")
                            }
                        />
                    </section>

                    <section className="pdf-section">
                        <GeofenceDashboard />
                    </section>
                </div>
            </main>
        </div>
    );
}
