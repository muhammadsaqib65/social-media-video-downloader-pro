"use client";

import { useEffect, useMemo, useState } from "react";

type Platform = "tiktok" | "instagram" | "youtube" | "unknown";

interface VideoInfo {
  platform: Platform;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  downloadUrl: string;
  sourceUrl?: string;
  fileName?: string;
}

interface HistoryItem {
  id: number;
  platform: string;
  url: string;
  title: string | null;
  author: string | null;
  thumbnail: string | null;
  downloadUrl: string | null;
  createdAt: string | null;
  success: boolean;
}

function detectPlatform(url: string): Platform {
  const value = url.toLowerCase();
  if (/tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/.test(value)) return "tiktok";
  if (/instagram\.com|instagr\.am/.test(value)) return "instagram";
  if (/youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com/.test(value)) {
    return "youtube";
  }
  return "unknown";
}

function platformLabel(platform: string) {
  if (platform === "tiktok") return "TikTok";
  if (platform === "instagram") return "Instagram";
  if (platform === "youtube") return "YouTube";
  return platform;
}

function platformBadgeClass(platform: string) {
  if (platform === "tiktok") return "bg-pink-500/15 text-pink-300 border-pink-500/30";
  if (platform === "instagram") return "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30";
  if (platform === "youtube") return "bg-red-500/15 text-red-300 border-red-500/30";
  return "bg-slate-500/15 text-slate-300 border-slate-500/30";
}

export default function VideoDownloaderPage() {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [installPrompt, setInstallPrompt] = useState(false);

  const detectedPlatform = useMemo(() => detectPlatform(videoUrl), [videoUrl]);

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const response = await fetch("/api/history");
      if (!response.ok) return;
      const data = await response.json();
      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch {
      // ignore history load errors in UI
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();

    // Support shared links: /?url=...
    if (typeof window !== "undefined") {
      const shared = new URLSearchParams(window.location.search).get("url");
      if (shared) {
        setVideoUrl(shared);
      }

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }
    }
  }, []);

  const processUrl = async (rawUrl?: string) => {
    const url = (rawUrl ?? videoUrl).trim();
    if (!url) {
      setError("Paste a TikTok, Instagram, or YouTube video link");
      return;
    }

    setLoading(true);
    setError("");
    setVideoInfo(null);

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to process video");
      }

      setVideoInfo(data);
      setVideoUrl(url);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const downloadVideoFile = async () => {
    if (!videoInfo) return;

    try {
      const target = videoInfo.downloadUrl || videoInfo.sourceUrl || videoUrl;
      if (!target) {
        setError("No download link available");
        return;
      }

      const a = document.createElement("a");
      a.href = target;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.download = videoInfo.fileName || `${videoInfo.title || "video"}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      setError("Failed to start download");
    }
  };

  const handleShare = async () => {
    if (!videoInfo) return;
    try {
      await navigator.share({
        title: videoInfo.title,
        text: `Download this ${platformLabel(videoInfo.platform)} video without watermark`,
        url: window.location.href,
      });
    } catch {
      // user cancelled or share unsupported
    }
  };

  const handleInstall = async () => {
    if (!navigator.share) {
      setInstallPrompt(true);
      setTimeout(() => setInstallPrompt(false), 3500);
      return;
    }
    try {
      await navigator.share({
        title: "Video Downloader Pro",
        text: "Install this app and share videos to download without watermark",
        url: window.location.href,
      });
    } catch {
      setInstallPrompt(true);
      setTimeout(() => setInstallPrompt(false), 3500);
    }
  };

  const reuseHistoryItem = (item: HistoryItem) => {
    setVideoUrl(item.url);
    setVideoInfo({
      platform: (item.platform as Platform) || "unknown",
      title: item.title || "Saved video",
      author: item.author || "Unknown",
      thumbnail: item.thumbnail || "",
      duration: 0,
      downloadUrl: item.downloadUrl || item.url,
      sourceUrl: item.url,
    });
  };

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      {installPrompt && (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border border-violet-400/30 bg-slate-900/95 px-4 py-3 text-sm text-violet-100 shadow-2xl">
          On mobile Chrome/Safari: open the browser menu and choose{" "}
          <span className="font-semibold">Install app</span> /{" "}
          <span className="font-semibold">Add to Home Screen</span>.
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
              No watermark · Mobile ready
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Video Downloader Pro
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              One search bar for TikTok, Instagram, and YouTube. Paste a link or
              share a video into this app.
            </p>
          </div>
          <button
            onClick={handleInstall}
            className="glow-button rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          >
            Install App
          </button>
        </header>

        <section className="glass-card rounded-3xl p-5 sm:p-7">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {(["tiktok", "instagram", "youtube"] as const).map((platform) => {
              const active = detectedPlatform === platform;
              return (
                <span
                  key={platform}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    active
                      ? platformBadgeClass(platform)
                      : "border-slate-700 text-slate-500"
                  }`}
                >
                  {platformLabel(platform)}
                </span>
              );
            })}
            {videoUrl && detectedPlatform === "unknown" && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
                Unsupported link
              </span>
            )}
          </div>

          <label className="mb-2 block text-sm font-medium text-slate-300">
            Paste any video link
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") processUrl();
              }}
              placeholder="https://www.tiktok.com/... or Instagram / YouTube link"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3.5 text-slate-100 outline-none ring-violet-500/40 placeholder:text-slate-500 focus:border-violet-400 focus:ring-2"
            />
            <button
              onClick={() => processUrl()}
              disabled={loading}
              className="glow-button shrink-0 rounded-2xl px-6 py-3.5 font-semibold text-white"
            >
              {loading ? "Processing..." : "Download"}
            </button>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Auto-detects the platform from the URL — no need to switch tabs.
          </p>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {videoInfo && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950/50">
              <div className="grid gap-0 sm:grid-cols-[180px_1fr]">
                <div className="min-h-40 bg-slate-900">
                  {videoInfo.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={videoInfo.thumbnail}
                      alt={videoInfo.title}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-full min-h-40 items-center justify-center text-slate-600">
                      No preview
                    </div>
                  )}
                </div>
                <div className="p-4 sm:p-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${platformBadgeClass(
                        videoInfo.platform
                      )}`}
                    >
                      {platformLabel(videoInfo.platform)}
                    </span>
                    {videoInfo.duration > 0 && (
                      <span className="text-xs text-slate-500">
                        {Math.floor(videoInfo.duration / 60)}:
                        {String(videoInfo.duration % 60).padStart(2, "0")}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-semibold text-white">{videoInfo.title}</h2>
                  <p className="mt-1 text-sm text-slate-400">By {videoInfo.author}</p>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={downloadVideoFile}
                      className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                    >
                      Download Video
                    </button>
                    <button
                      onClick={handleShare}
                      className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-400"
                    >
                      Share
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="glass-card mt-6 rounded-3xl p-5 sm:p-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Recent downloads</h3>
            <button
              onClick={loadHistory}
              className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
            >
              Refresh
            </button>
          </div>

          {historyLoading ? (
            <p className="text-sm text-slate-500">Loading history...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-500">
              No downloads yet. Paste a link above to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => reuseHistoryItem(item)}
                  className="flex w-full items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-left transition hover:border-slate-600"
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-900">
                    {item.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumbnail}
                        alt={item.title || "thumbnail"}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${platformBadgeClass(
                          item.platform
                        )}`}
                      >
                        {platformLabel(item.platform)}
                      </span>
                      {!item.success && (
                        <span className="text-[10px] text-red-400">failed</span>
                      )}
                    </div>
                    <p className="truncate text-sm font-medium text-slate-100">
                      {item.title || item.url}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {item.author || "Unknown"} · {item.url}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="mt-6 rounded-3xl border border-amber-400/20 bg-amber-400/5 p-5">
          <h4 className="mb-2 font-semibold text-amber-200">Mobile install & share</h4>
          <ul className="space-y-1.5 text-sm text-amber-100/80">
            <li>• Install this site as an app from your browser menu</li>
            <li>• From TikTok / Instagram / YouTube, use Share → this app / browser</li>
            <li>• Open the shared link here and tap Download</li>
            <li>• One combined search bar auto-detects the platform</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
