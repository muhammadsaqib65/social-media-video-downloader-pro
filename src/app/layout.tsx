import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#6366f1",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "Video Downloader Pro",
  description: "Download TikTok videos and Instagram Reels/posts on mobile. YouTube is shown as limited on Vercel.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "VideoDL",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
    "application-name": "VideoDL",
    "msapplication-TileColor": "#6366f1",
  },
  icons: [
    {
      rel: "icon",
      url: "/favicon.ico",
    },
    {
      rel: "apple-touch-icon",
      url: "/icon-192x192.png",
    },
    {
      rel: "apple-touch-icon",
      sizes: "192x192",
      url: "/icon-192x192.png",
    },
    {
      rel: "apple-touch-icon",
      sizes: "512x512",
      url: "/icon-512x512.png",
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-gray-950 text-gray-100 antialiased">{children}</body>
    </html>
  );
}
