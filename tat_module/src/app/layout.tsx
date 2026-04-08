import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unifleet | AI Fleet Intelligence",
  description: "Advanced Telemetrics Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link href='https://api.mapbox.com/mapbox-gl-js/v3.1.2/mapbox-gl.css' rel='stylesheet' />
      </head>
      <body className="antialiased bg-[#F8F9FB] text-slate-900">
        {children}
      </body>
    </html>
  );
}
