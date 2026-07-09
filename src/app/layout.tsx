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
  applicationName: "Video Downloader Pro",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VideoDL",
  },
  formatDetection: {
    telephone: false,
  },
  icons: [
    { rel: "icon", url: "/favicon.ico" },
    { rel: "apple-touch-icon", url: "/icon-192x192.png" },
    { rel: "apple-touch-icon", sizes: "192x192", url: "/icon-192x192.png" },
    { rel: "apple-touch-icon", sizes: "512x512", url: "/icon-512x512.png" },
  ],
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="VideoDL" />
      </head>
      <body className="min-h-screen bg-[#070b14] text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
