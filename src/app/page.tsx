"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Platform = "tiktok" | "instagram" | "youtube" | "unknown";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

interface QualityOption {
  label: string;
  height: number;
  itag: number;
  hasAudio: boolean;
  container: string;
  approxSize?: number;
}

interface VideoInfo {
  platform: Platform;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  downloadUrl: string;
  sourceUrl?: string;
  fileName?: string;
  qualities?: QualityOption[];
  selectedQuality?: string;
  warning?: string;
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

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Platforms with full server-side support vs limited support
const PLATFORM_SUPPORT: Record<Platform, "full" | "limited"> = {
  tiktok: "full",
  instagram: "full",
  youtube: "limited",
  unknown: "full",
};

// External downloaders used as fallback when our server cannot fetch YouTube
function getExternalDownloaderLinks(videoUrl: string): Array<{
  name: string;
  description: string;
  href: string;
}> {
  const encoded = encodeURIComponent(videoUrl);
  return [
    {
      name: "Cobalt",
      description: "No ads, open source",
      href: `https://cobalt.tools/`,
    },
    {
      name: "SSYouTube",
      description: "Add 'ss' before youtube.com",
      href: videoUrl.replace(
        /^(https?:\/\/)(?:www\.)?(youtube\.com|youtu\.be)/i,
        "$1ss$2"
      ),
    },
    {
      name: "Y2Mate",
      description: "Popular web converter",
      href: `https://www.y2mate.com/youtube/${encoded}`,
    },
    {
      name: "9xBuddy",
      description: "Multi-quality selector",
      href: `https://9xbuddy.com/process?url=${encoded}`,
    },
  ];
}

export default function VideoDownloaderPage() {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedQuality, setSelectedQuality] = useState("best");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [igReady, setIgReady] = useState<boolean | null>(null);
  const deferredInstallPrompt = useRef<BeforeInstallPromptEvent | null>(null);

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
    fetch("/api/instagram/status")
      .then((r) => r.json())
      .then((d) => setIgReady(Boolean(d?.instagram?.ready)))
      .catch(() => setIgReady(null));

    if (typeof window === "undefined") return;

    // Support shared links / PWA share_target: /?url=...
    const params = new URLSearchParams(window.location.search);
    const shared =
      params.get("url") || params.get("text") || params.get("title") || "";
    if (shared) {
      // If share target sent text with a URL inside, extract first URL
      const urlInText = shared.match(/https?:\/\/[^\s]+/i)?.[0] || shared;
      if (/^https?:\/\//i.test(urlInText)) {
        setVideoUrl(urlInText);
      }
    }

    const ua = window.navigator.userAgent || "";
    const ios =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIos(ios);

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    setIsInstalled(standalone);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const onBeforeInstallPrompt = (event: Event) => {
      // Prevent Chrome mini-infobar; we use our Install button instead
      event.preventDefault();
      deferredInstallPrompt.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };

    const onAppInstalled = () => {
      deferredInstallPrompt.current = null;
      setCanInstall(false);
      setIsInstalled(true);
      setShowInstallHelp(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
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
    setSelectedQuality("best");

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

      const normalized: VideoInfo = {
        platform: data.platform,
        title: data.title || "Video",
        author: data.author || "Unknown",
        thumbnail: data.thumbnail || "",
        duration: Number(data.duration || 0) || 0,
        downloadUrl: data.downloadUrl || "",
        sourceUrl: data.sourceUrl || url,
        fileName: data.fileName || "video.mp4",
        qualities: Array.isArray(data.qualities) ? data.qualities : [],
        selectedQuality: data.selectedQuality,
        warning: typeof data.warning === "string" ? data.warning : undefined,
      };

      setVideoInfo(normalized);
      setVideoUrl(url);
      if (normalized.platform === "youtube") {
        setSelectedQuality(
          normalized.selectedQuality ||
            normalized.qualities?.[0]?.label ||
            "best"
        );
      }
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
      const source = videoInfo.sourceUrl || videoUrl;
      if (!source) {
        setError("No download link available");
        return;
      }

      // Always proxy through our API so the browser downloads a real file
      // instead of navigating to TikTok/Instagram/YouTube pages.
      let target = "";
      if (videoInfo.platform === "youtube") {
        const quality = selectedQuality || videoInfo.selectedQuality || "best";
        target = `/api/download/youtube/file?url=${encodeURIComponent(
          source
        )}&quality=${encodeURIComponent(quality)}`;
      } else if (videoInfo.platform === "tiktok") {
        target = `/api/download/tiktok/file?url=${encodeURIComponent(source)}`;
      } else if (videoInfo.platform === "instagram") {
        target = `/api/download/instagram/file?url=${encodeURIComponent(source)}`;
      } else if (videoInfo.downloadUrl?.startsWith("/api/")) {
        target = videoInfo.downloadUrl;
      } else {
        throw new Error("Unsupported platform for download");
      }

      setDownloading(true);
      setError("");

      const response = await fetch(target);
      const contentType = response.headers.get("content-type") || "";

      if (!response.ok) {
        const data = contentType.includes("application/json")
          ? await response.json().catch(() => ({}))
          : {};
        throw new Error(
          (data as { error?: string }).error ||
            `Download failed (${response.status})`
        );
      }

      // Guard against APIs accidentally returning JSON/HTML
      if (contentType.includes("application/json")) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ||
            "Server returned JSON instead of a video file"
        );
      }

      const blob = await response.blob();
      if (!blob || blob.size < 1000) {
        throw new Error("Downloaded file is empty or invalid");
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const qualitySuffix =
        videoInfo.platform === "youtube" && selectedQuality
          ? `_${selectedQuality}`
          : "";
      a.download =
        videoInfo.fileName?.replace(/\.mp4$/i, `${qualitySuffix}.mp4`) ||
        `${videoInfo.title || "video"}${qualitySuffix}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      setDownloading(false);
    } catch (err) {
      setDownloading(false);
      setError(err instanceof Error ? err.message : "Failed to start download");
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
    // Already installed / running as app
    if (isInstalled) {
      setShowInstallHelp(true);
      return;
    }

    // Android/Chrome/Edge: native install prompt
    if (deferredInstallPrompt.current) {
      try {
        await deferredInstallPrompt.current.prompt();
        const choice = await deferredInstallPrompt.current.userChoice;
        if (choice.outcome === "accepted") {
          setIsInstalled(true);
          setCanInstall(false);
          deferredInstallPrompt.current = null;
          setShowInstallHelp(false);
          return;
        }
      } catch {
        // fall through to help instructions
      }
    }

    // iOS / unsupported browsers: show install instructions (never open share menu)
    setShowInstallHelp(true);
  };

  const reuseHistoryItem = (item: HistoryItem) => {
    setVideoUrl(item.url);
    setSelectedQuality("best");
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
      {showInstallHelp && (
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg p-4">
          <div className="rounded-3xl border border-violet-400/30 bg-slate-950/95 p-5 text-sm text-slate-100 shadow-2xl backdrop-blur">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-white">
                  {isInstalled ? "App already installed" : "Install Video Downloader"}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {isInstalled
                    ? "Open it from your home screen for the full app experience."
                    : "Add this app to your phone home screen."}
                </p>
              </div>
              <button
                onClick={() => setShowInstallHelp(false)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {isIos ? (
              <ol className="space-y-2 text-sm text-slate-200">
                <li>
                  1. Tap the <span className="font-semibold">Share</span> button in Safari
                  (square with arrow)
                </li>
                <li>
                  2. Scroll and tap{" "}
                  <span className="font-semibold">Add to Home Screen</span>
                </li>
                <li>
                  3. Tap <span className="font-semibold">Add</span>
                </li>
              </ol>
            ) : canInstall ? (
              <p className="text-sm text-slate-200">
                Tap <span className="font-semibold">Install App</span> again to open the
                system install popup.
              </p>
            ) : (
              <ol className="space-y-2 text-sm text-slate-200">
                <li>
                  1. Open this site in <span className="font-semibold">Chrome</span>
                </li>
                <li>
                  2. Tap the browser menu <span className="font-semibold">⋮</span>
                </li>
                <li>
                  3. Choose <span className="font-semibold">Install app</span> or{" "}
                  <span className="font-semibold">Add to Home screen</span>
                </li>
              </ol>
            )}

            <button
              onClick={() => setShowInstallHelp(false)}
              className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Got it
            </button>
          </div>
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
              Paste any TikTok, Instagram, or YouTube link. TikTok and Instagram
              are fully supported. YouTube is{" "}
              <span className="font-medium text-amber-300">limited</span> on
              Vercel — if our server is blocked, use the external tools below.
            </p>
          </div>
          <button
            onClick={handleInstall}
            className="glow-button rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          >
            {isInstalled ? "✓ Installed" : "Install App"}
          </button>
        </header>

        <section className="glass-card rounded-3xl p-5 sm:p-7">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {(["tiktok", "instagram", "youtube"] as const).map((platform) => {
              const active = detectedPlatform === platform;
              const support = PLATFORM_SUPPORT[platform];
              return (
                <span
                  key={platform}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                    active
                      ? platformBadgeClass(platform)
                      : "border-slate-700 text-slate-500"
                  }`}
                >
                  {platformLabel(platform)}
                  {support === "limited" && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        active
                          ? "bg-amber-500/20 text-amber-200"
                          : "bg-slate-800 text-amber-400/80"
                      }`}
                    >
                      Limited
                    </span>
                  )}
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

          {detectedPlatform === "youtube" && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
              <span className="mt-0.5 text-sm">⚠️</span>
              <span>
                YouTube is limited on Vercel because Google often blocks
                serverless IPs. We still try — if it fails, use the external
                tools that appear after loading the video.
              </span>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {igReady === false && (
            <div className="mt-4 rounded-2xl border border-pink-500/30 bg-pink-500/10 px-4 py-3 text-sm text-pink-100">
              <p className="font-semibold text-pink-200">Instagram setup needed on Vercel</p>
              <p className="mt-1 text-pink-100/90">
                Add <span className="font-semibold">INSTAGRAM_COOKIE</span> in Vercel Environment
                Variables, then redeploy. Copy the full cookie header from instagram.com while
                logged in (DevTools → Network → cookie).
              </p>
            </div>
          )}

          {videoInfo?.warning && (
            <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              {videoInfo.warning}
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

                  {videoInfo.platform === "youtube" && (
                    <div className="mt-4">
                      <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                        Resolution
                      </label>
                      {Array.isArray(videoInfo.qualities) &&
                      videoInfo.qualities.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {videoInfo.qualities.map((quality) => {
                            const active = selectedQuality === quality.label;
                            return (
                              <button
                                key={`${quality.label}-${quality.itag}`}
                                type="button"
                                onClick={() => setSelectedQuality(quality.label)}
                                className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                                  active
                                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                                }`}
                              >
                                <div className="font-semibold">{quality.label}</div>
                                <div className="mt-0.5 text-[10px] opacity-70">
                                  {quality.hasAudio ? "Video + Audio" : "Merged"}
                                  {quality.approxSize
                                    ? ` · ~${formatBytes(quality.approxSize)}`
                                    : ""}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                          Resolutions unavailable for this video on the current
                          server. You can still try Best quality download.
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={downloadVideoFile}
                      disabled={downloading}
                      className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {downloading
                        ? `Downloading${
                            videoInfo.platform === "youtube" && selectedQuality
                              ? ` ${selectedQuality}`
                              : ""
                          }...`
                        : videoInfo.platform === "youtube" && selectedQuality
                          ? `Download ${selectedQuality}`
                          : "Download Video"}
                    </button>
                    <button
                      onClick={handleShare}
                      className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-400"
                    >
                      Share
                    </button>
                  </div>

                  {videoInfo.platform === "youtube" && (
                    <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                      <p className="mb-2 text-xs font-medium text-slate-300">
                        If the download above fails, open this video in a trusted
                        external tool:
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {getExternalDownloaderLinks(
                          videoInfo.sourceUrl || videoUrl
                        ).map((tool) => (
                          <a
                            key={tool.name}
                            href={tool.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-center transition hover:border-violet-500/60 hover:bg-slate-900"
                          >
                            <div className="text-xs font-semibold text-white">
                              {tool.name}
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              {tool.description}
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
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

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/5 p-5">
            <h4 className="mb-2 font-semibold text-emerald-200">
              ✅ Full support
            </h4>
            <ul className="space-y-1.5 text-sm text-emerald-100/80">
              <li>• TikTok videos (no watermark)</li>
              <li>• Instagram Reels and posts</li>
              <li>• Direct download — no external tools needed</li>
            </ul>
            <p className="mt-3 text-xs text-emerald-200/70">
              Tip: on Vercel add <code className="rounded bg-black/30 px-1">INSTAGRAM_COOKIE</code> for
              best Instagram reliability.
            </p>
          </div>

          <div className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-5">
            <h4 className="mb-2 font-semibold text-amber-200">
              ⚠️ Limited support — YouTube
            </h4>
            <ul className="space-y-1.5 text-sm text-amber-100/80">
              <li>• We try first, with multi-provider fallbacks</li>
              <li>• If blocked, external tools appear automatically</li>
              <li>• Optional: add <code className="rounded bg-black/30 px-1">YOUTUBE_COOKIE</code> in Vercel for full support</li>
            </ul>
          </div>
        </section>

        <section className="mt-4 rounded-3xl border border-slate-700/60 bg-slate-900/40 p-5">
          <h4 className="mb-2 font-semibold text-slate-100">
            📱 Install as a mobile app
          </h4>
          <ul className="space-y-1.5 text-sm text-slate-300">
            <li>• Tap the <span className="font-semibold">Install App</span> button above</li>
            <li>• Or share a TikTok / Instagram / YouTube link into this app</li>
            <li>• On iPhone use Safari → Share → Add to Home Screen</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
