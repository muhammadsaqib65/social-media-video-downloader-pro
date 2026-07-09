"use client";

import { useState, useEffect } from "react";

interface VideoFormat {
  itag: number;
  quality: string;
  qualityLabel: string;
  container: string;
  hasVideo?: boolean;
  hasAudio?: boolean;
  contentLength?: string;
}

interface VideoInfo {
  title: string;
  downloadUrl: string;
  thumbnail: string;
  duration: number;
  author: string;
  videoId?: string;
  formats?: VideoFormat[];
  bestFormat?: VideoFormat;
  requiresMerge?: boolean;
  videoUrl?: string;
  audioUrl?: string;
  error?: string;
  details?: string;
  note?: string;
  allFormats?: VideoFormat[];
}

interface HistoryEntry {
  id: number;
  platform: string;
  url: string;
  fileName: string | null;
  success: boolean;
  createdAt: string;
}

type Platform = 'tiktok' | 'instagram' | 'youtube';

export default function VideoDownloaderPage() {
  const [url, setUrl] = useState("");
  const [activeTab, setActiveTab] = useState<Platform | "all">("all");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [detectedPlatform, setDetectedPlatform] = useState<Platform | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState<string>("best");
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installChecking, setInstallChecking] = useState(false);

  // Detect platform from URL
  useEffect(() => {
    if (!url) {
      setDetectedPlatform(null);
      return;
    }

    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes("tiktok.com") || lowerUrl.includes("vm.tiktok")) {
      setDetectedPlatform("tiktok");
    } else if (lowerUrl.includes("instagram.com") || lowerUrl.includes("dd.instagram")) {
      setDetectedPlatform("instagram");
    } else if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
      setDetectedPlatform("youtube");
    } else {
      setDetectedPlatform(null);
    }
  }, [url]);

  // Fetch history
  const fetchHistory = async () => {
    try {
      const response = await fetch("/api/history");
      const data = await response.json();
      if (data.success) {
        setHistory(data.history || []);
      }
    } catch {
      // Silently fail for history
    }
  };

  useEffect(() => {
    if (showHistory) {
      fetchHistory();
    }
  }, [showHistory]);

  // Register service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => registration.update().catch(() => undefined))
        .catch(() => undefined);
    }
  }, []);

  // Check for deferred install prompt
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsInstalled(standalone);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };

    const installedHandler = () => {
      setIsInstalled(true);
      setDeferredInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const getVideoInfo = async () => {
    if (!url) {
      setError("Please enter a video URL");
      return;
    }

    if (!detectedPlatform) {
      setError("Please enter a valid TikTok or Instagram URL.");
      return;
    }

    if (detectedPlatform === "youtube") {
      setVideoInfo(null);
      setError("YouTube is limited on Vercel and often blocks downloads. This app now focuses on TikTok and Instagram for reliable downloads.");
      return;
    }

    setLoading(true);
    setError("");
    setVideoInfo(null);

    try {
      const response = await fetch(`/api/download/${detectedPlatform}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch video info");
      }

      const data = await response.json();
      
      // Check if there's an error in the response
      if (data.error) {
        throw new Error(data.error);
      }
      
      setVideoInfo(data);

      // Add to history
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: detectedPlatform,
          url,
          fileName: data.title,
          success: true,
        }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const downloadVideo = async (quality?: string) => {
    if (!videoInfo || !detectedPlatform) return;

    setDownloading(true);
    try {
      let downloadUrl = `/api/download/${detectedPlatform}/video?url=${encodeURIComponent(url)}`;
      
      // Add quality/itag for YouTube
      if (detectedPlatform === 'youtube' && quality && quality !== 'best') {
        downloadUrl += `&itag=${quality}`;
      }

      const response = await fetch(downloadUrl);

      // Check if response is JSON (error) or binary (file)
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        // It's a JSON error response
        const data = await response.json();
        
        if (data.error) {
          if (data.error.includes("403") || data.error.includes("blocking") || data.error.includes("failed to fetch")) {
            setError(`YouTube blocked the download. This is common for YouTube videos. Try TikTok or Instagram instead.`);
          } else {
            setError(data.error);
          }
        } else {
          setError("Download not available for this video");
        }
        setDownloading(false);
        return;
      }

      // It's a binary file (video/image)
      if (contentType.includes('video') || contentType.includes('image')) {
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const extension = contentType.includes('video') ? 'mp4' : 'jpg';
        const safeTitle = videoInfo.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${safeTitle}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);
        setTimeout(() => setDownloading(false), 2000);
        return;
      }

      // Fallback: try to open the response as a URL
      const blob = await response.blob();
      if (blob.size > 0) {
        const blobUrl = window.URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        setTimeout(() => setDownloading(false), 2000);
        return;
      }

      setError("Download failed. Please try again.");
    } catch (err) {
      console.error("Download error:", err);
      setError("Failed to download video. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  // Get unique qualities from formats
  const getUniqueQualities = () => {
    if (!videoInfo?.formats) return [];
    const seen = new Set<string>();
    return videoInfo.formats
      .filter(f => f.hasVideo && f.hasAudio)
      .map(f => ({
        itag: f.itag.toString(),
        quality: f.qualityLabel || f.quality,
        container: f.container,
        size: f.contentLength ? formatFileSize(parseInt(f.contentLength)) : 'Unknown'
      }))
      .filter(f => {
        if (seen.has(f.quality)) return false;
        seen.add(f.quality);
        return true;
      })
      .sort((a, b) => {
        const aRes = parseInt(a.quality.replace(/\D/g, '')) || 0;
        const bRes = parseInt(b.quality.replace(/\D/g, '')) || 0;
        return bRes - aRes;
      });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const handleShare = async () => {
    if (!navigator.canShare) {
      alert("Sharing not supported on this device");
      return;
    }

    try {
      await navigator.share({
        title: "Video Downloader Pro",
        text: "Download videos from TikTok, Instagram & YouTube without watermark!",
        url: window.location.href,
      });
    } catch {
      // User cancelled or error
    }
  };

  const handleInstall = async () => {
    if (isInstalled) {
      alert("App is already installed on this device.");
      return;
    }

    let promptEvent = deferredInstallPrompt;

    if (!promptEvent) {
      setInstallChecking(true);
      try {
        if ("serviceWorker" in navigator) {
          await navigator.serviceWorker.register("/sw.js", { scope: "/" });
          await navigator.serviceWorker.ready;
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
        promptEvent = deferredInstallPrompt;
      } finally {
        setInstallChecking(false);
      }
    }

    if (promptEvent) {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice?.outcome === "accepted") {
          setIsInstalled(true);
        }
        setDeferredInstallPrompt(null);
        return;
      } catch {
        setDeferredInstallPrompt(null);
      }
    }

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isAndroid = /android/i.test(navigator.userAgent);

    if (isIos) {
      alert("iPhone install:\n\n1. Open this site in Safari\n2. Tap the Share button\n3. Tap 'Add to Home Screen'\n\niOS does not allow websites to open the install popup automatically.");
      return;
    }

    if (isAndroid) {
      alert("Android install:\n\nIf the popup did not appear, open this site in Chrome, wait 5 seconds, then tap browser menu (⋮) → 'Install app'.\n\nChrome only shows the install popup after it confirms the app is installable.");
      return;
    }

    alert("Desktop install:\n\nUse Chrome/Edge and click the install icon in the address bar, or open browser menu → 'Install VideoDL'.");
  };

  const clearHistory = async () => {
    try {
      await fetch("/api/history?all=true", { method: "DELETE" });
      setHistory([]);
    } catch {
      setError("Failed to clear history");
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case "tiktok":
        return "🎵";
      case "instagram":
        return "📸";
      case "youtube":
        return "▶️";
      default:
        return "🎬";
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            VideoDL Pro
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
              title="History"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button
              onClick={handleInstall}
              disabled={installChecking}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-70 disabled:cursor-wait ${
                isInstalled ? "bg-green-700 hover:bg-green-600" : "bg-violet-600 hover:bg-violet-500"
              }`}
              title={deferredInstallPrompt ? "Install app now" : "Install app"}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              {isInstalled ? "Installed" : installChecking ? "Preparing..." : deferredInstallPrompt ? "Install App" : "Install App"}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Combined Search Bar */}
        <div className="mb-8">
          <div className="relative">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste TikTok video, Instagram Reel, or Instagram post URL here..."
              className="w-full px-4 py-4 pr-12 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
              onKeyDown={(e) => e.key === "Enter" && getVideoInfo()}
            />
            <button
              onClick={getVideoInfo}
              disabled={loading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-violet-600 hover:bg-violet-500 rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            </button>
          </div>

          {/* Platform Detection Indicator */}
          {url && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-gray-400">Detected:</span>
              {detectedPlatform ? (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
                  detectedPlatform === "tiktok" ? "bg-pink-900/50 text-pink-300" :
                  detectedPlatform === "instagram" ? "bg-gradient-to-r from-purple-900/50 to-pink-900/50 text-pink-300" :
                  "bg-red-900/50 text-red-300"
                }`}>
                  {getPlatformIcon(detectedPlatform)} {detectedPlatform.charAt(0).toUpperCase() + detectedPlatform.slice(1)}{detectedPlatform === "youtube" ? " • Limited" : ""}
                </span>
              ) : (
                <span className="text-sm text-amber-400">⚠️ Unsupported URL</span>
              )}
            </div>
          )}
        </div>

        {/* Quick Platform Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {(["all", "tiktok", "instagram"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-all ${
                activeTab === tab
                  ? "bg-violet-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {tab === "all" ? "🌐 All" : `${getPlatformIcon(tab)} ${tab.charAt(0).toUpperCase() + tab.slice(1)}`}
            </button>
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-300">
            <div className="font-medium flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Download Error
            </div>
            <p className="mt-2 text-sm">{error}</p>
            {detectedPlatform === 'youtube' && (
              <div className="mt-3 p-3 bg-amber-900/30 border border-amber-800 rounded-lg text-amber-300 text-xs">
                <p className="font-medium mb-1">⚠️ YouTube Limited Support</p>
                <p>This Vercel version is optimized for TikTok and Instagram. For YouTube, use your browser’s built-in save tools or a dedicated desktop downloader.</p>
              </div>
            )}
          </div>
        )}

        {/* Video Info Card */}
        {videoInfo && (
          <div className="mb-8 p-5 bg-gray-900 border border-gray-800 rounded-2xl">
            <div className="flex gap-4">
              {videoInfo.thumbnail && (
                <img
                  src={videoInfo.thumbnail}
                  alt={videoInfo.title}
                  className="w-32 h-20 object-cover rounded-lg hidden sm:block"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white truncate">{videoInfo.title}</h3>
                <p className="text-sm text-gray-400 mt-1">
                  {getPlatformIcon(detectedPlatform || "")} {(detectedPlatform || "").charAt(0).toUpperCase() + (detectedPlatform || "").slice(1)} • {videoInfo.author}
                </p>
                {videoInfo.duration > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Duration: {Math.floor(videoInfo.duration / 60)}:{String(videoInfo.duration % 60).padStart(2, "0")}
                  </p>
                )}
              </div>
            </div>

            {/* Quality Selection for YouTube */}
            {detectedPlatform === 'youtube' && videoInfo.formats && videoInfo.formats.length > 0 && (
              <div className="mt-4 p-3 bg-gray-800/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-300 font-medium">Select Quality</span>
                  <button
                    onClick={() => setShowQualityModal(!showQualityModal)}
                    className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                  >
                    {showQualityModal ? 'Hide' : 'Show'} Options
                    <svg className={`w-3 h-3 transition-transform ${showQualityModal ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* Quality Grid */}
                {showQualityModal && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                    {/* Best Quality Option */}
                    <button
                      onClick={() => { setSelectedQuality('best'); setShowQualityModal(false); }}
                      className={`p-2 rounded-lg border text-left transition-all ${
                        selectedQuality === 'best'
                          ? 'border-violet-500 bg-violet-600/20'
                          : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                      }`}
                    >
                      <div className="text-sm font-medium text-white">Best Quality</div>
                      <div className="text-xs text-gray-400">Auto</div>
                    </button>

                    {/* Quality Options */}
                    {getUniqueQualities().map((q) => (
                      <button
                        key={q.itag}
                        onClick={() => { setSelectedQuality(q.itag); setShowQualityModal(false); }}
                        className={`p-2 rounded-lg border text-left transition-all ${
                          selectedQuality === q.itag
                            ? 'border-violet-500 bg-violet-600/20'
                            : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                        }`}
                      >
                        <div className="text-sm font-medium text-white">{q.quality}</div>
                        <div className="text-xs text-gray-400">{q.container.toUpperCase()} • {q.size}</div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Selected Quality Indicator */}
                {!showQualityModal && (
                  <div className="mt-2 text-sm text-gray-300">
                    Selected: <span className="text-violet-400 font-medium">
                      {selectedQuality === 'best' ? 'Best Quality (Auto)' : 
                        getUniqueQualities().find(q => q.itag === selectedQuality)?.quality || 'Best Quality'}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => downloadVideo(selectedQuality)}
                disabled={downloading}
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                {downloading ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Downloading...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download {selectedQuality !== 'best' && `(${getUniqueQualities().find(q => q.itag === selectedQuality)?.quality || ''})`}
                  </>
                )}
              </button>
              <button
                onClick={handleShare}
                className="px-4 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors"
                title="Share"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Platform Support Notice */}
        {detectedPlatform === 'youtube' && (
          <div className="mb-6 p-4 bg-amber-900/20 border border-amber-700/50 rounded-xl">
            <h4 className="text-amber-400 font-medium flex items-center gap-2 mb-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              YouTube is limited on Vercel
            </h4>
            <p className="text-sm text-amber-300/80">
              YouTube frequently blocks Vercel/serverless IPs, so this app now focuses on reliable TikTok and Instagram downloads. Paste a TikTok video, Instagram Reel, or Instagram post link for best results.
            </p>
          </div>
        )}

        {/* Features */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { icon: "🎵", title: "TikTok", desc: "Supported" },
            { icon: "📸", title: "Instagram", desc: "Reels & Posts" },
            { icon: "▶️", title: "YouTube", desc: "Limited on Vercel" },
          ].map((feature, i) => (
            <div key={i} className={`p-4 bg-gray-900 border border-gray-800 rounded-xl text-center ${
              (feature.title === 'TikTok' && !detectedPlatform) || detectedPlatform === 'tiktok' ? 'border-green-600/50' : ''
            } ${(feature.title === 'Instagram' && !detectedPlatform) || detectedPlatform === 'instagram' ? 'border-pink-600/50' : ''
            } ${(feature.title === 'YouTube' && !detectedPlatform) || detectedPlatform === 'youtube' ? 'border-red-600/50' : ''}`}>
              <div className="text-2xl mb-1">{feature.icon}</div>
              <div className="text-sm font-medium text-white">{feature.title}</div>
              <div className="text-xs text-gray-500">{feature.desc}</div>
            </div>
          ))}
        </div>

        {/* Instructions */}
        <div className="p-5 bg-gray-900 border border-gray-800 rounded-xl">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            📖 How to Use
          </h3>
          <ol className="space-y-2 text-sm text-gray-400">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-violet-600 rounded-full flex items-center justify-center text-white text-xs font-bold">1</span>
              <span>Copy a TikTok video, Instagram Reel, or Instagram post URL</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-violet-600 rounded-full flex items-center justify-center text-white text-xs font-bold">2</span>
              <span>Paste it in the search box above</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-violet-600 rounded-full flex items-center justify-center text-white text-xs font-bold">3</span>
              <span>Tap Download to save without watermark</span>
            </li>
          </ol>
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="mt-8 p-5 bg-gray-900 border border-gray-800 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Download History</h3>
              <div className="flex gap-2">
                <button
                  onClick={fetchHistory}
                  className="text-sm text-violet-400 hover:text-violet-300"
                >
                  Refresh
                </button>
                <button
                  onClick={clearHistory}
                  className="text-sm text-red-400 hover:text-red-300"
                >
                  Clear All
                </button>
              </div>
            </div>

            {history.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No download history yet</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg"
                  >
                    <span className="text-lg">{getPlatformIcon(entry.platform)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{entry.fileName || entry.url}</p>
                      <p className="text-xs text-gray-500">{formatDate(entry.createdAt)}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      entry.success ? "bg-green-900/50 text-green-300" : "bg-red-900/50 text-red-300"
                    }`}>
                      {entry.success ? "✓" : "✗"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-12 py-6 border-t border-gray-800 text-center text-gray-500 text-sm">
        <p>Video Downloader Pro • Download responsibly</p>
      </footer>
    </main>
  );
}