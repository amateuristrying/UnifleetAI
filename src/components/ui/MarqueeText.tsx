import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface MarqueeTextProps {
    text: string;
    className?: string;
    delay?: number; // ms
    speed?: number; // seconds for full scroll
}

export function MarqueeText({ text, className, delay = 500, speed = 10 }: MarqueeTextProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const [shouldScroll, setShouldScroll] = useState(false);

    useEffect(() => {
        const checkScroll = () => {
            if (containerRef.current && textRef.current) {
                // Check if text is wider than container
                if (textRef.current.scrollWidth > containerRef.current.clientWidth) {
                    setShouldScroll(true);
                } else {
                    setShouldScroll(false);
                }
            }
        };

        // Initial check
        checkScroll();

        // Optional: Re-check on window resize
        window.addEventListener('resize', checkScroll);
        return () => window.removeEventListener('resize', checkScroll);
    }, [text]); // Re-run if text changes

    return (
        <div
            ref={containerRef}
            className={cn("w-full overflow-hidden whitespace-nowrap relative group/marquee", className)}
        >
            {shouldScroll ? (
                <div
                    className="flex min-w-full"
                    style={{
                        animation: `marquee ${speed}s linear infinite`,
                        animationDelay: `${delay}ms`
                    }}
                >
                    <span ref={textRef} className="pr-8">{text}</span>
                    <span>{text}</span> {/* Duplicate for seamless loop */}
                </div>
            ) : (
                <span ref={textRef} className="block truncate">{text}</span>
            )}
        </div>
    );
}
