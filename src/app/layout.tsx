import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#070b14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: "Video Downloader Pro",
  description:
    "Download TikTok, Instagram, and YouTube videos without watermark. Install on mobile and share videos to download!",
  manifest: "/manifest.json",
  icons: [
    { rel: "icon", url: "/favicon.ico" },
    { rel: "apple-touch-icon", url: "/icon-192x192.png" },
    { rel: "apple-touch-icon", sizes: "192x192", url: "/icon-192x192.png" },
    { rel: "apple-touch-icon", sizes: "512x512", url: "/icon-512x512.png" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#070b14] text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
