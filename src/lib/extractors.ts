import type { Platform } from "@/lib/platform";
import { sanitizeFileName } from "@/lib/platform";
import { extractYouTube as extractYouTubeCore } from "@/lib/youtube";

export type ExtractedVideo = {
  platform: Platform;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  sourceUrl: string;
  downloadUrl: string;
  fileName: string;
  videoId?: string;
  qualities?: Array<{
    label: string;
    height: number;
    itag: number;
    hasAudio: boolean;
    container: string;
    approxSize?: number;
  }>;
  selectedQuality?: string;
};

export async function extractTikTok(url: string): Promise<ExtractedVideo> {
  const oembedResponse = await fetch(
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      next: { revalidate: 0 },
    }
  );

  if (!oembedResponse.ok) {
    throw new Error(
      "Could not fetch TikTok video info. Check the URL and try again."
    );
  }

  const data = (await oembedResponse.json()) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  };

  const title = data.title || "TikTok Video";

  return {
    platform: "tiktok",
    title,
    author: data.author_name || "Unknown",
    thumbnail: data.thumbnail_url || "",
    duration: 0,
    sourceUrl: url,
    downloadUrl: url,
    fileName: `${sanitizeFileName(title)}.mp4`,
  };
}

export async function extractInstagram(url: string): Promise<ExtractedVideo> {
  try {
    const oembedResponse = await fetch(
      `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        next: { revalidate: 0 },
      }
    );

    if (oembedResponse.ok) {
      const data = (await oembedResponse.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };

      const title = data.title || "Instagram Video";
      return {
        platform: "instagram",
        title,
        author: data.author_name || "Unknown",
        thumbnail: data.thumbnail_url || "",
        duration: 0,
        sourceUrl: url,
        downloadUrl: url,
        fileName: `${sanitizeFileName(title)}.mp4`,
      };
    }
  } catch {
    // continue to fallback
  }

  const shortcodeMatch = url.match(/\/(p|reel|tv)\/([^/?#]+)/i);
  const title = shortcodeMatch
    ? `Instagram ${shortcodeMatch[1]} ${shortcodeMatch[2]}`
    : "Instagram Video";

  return {
    platform: "instagram",
    title,
    author: "Unknown",
    thumbnail: "",
    duration: 0,
    sourceUrl: url,
    downloadUrl: url,
    fileName: `${sanitizeFileName(title)}.mp4`,
  };
}

export async function extractYouTube(url: string): Promise<ExtractedVideo> {
  return extractYouTubeCore(url);
}

export async function extractVideo(
  url: string,
  platform: Platform
): Promise<ExtractedVideo> {
  switch (platform) {
    case "tiktok":
      return extractTikTok(url);
    case "instagram":
      return extractInstagram(url);
    case "youtube":
      return extractYouTube(url);
    default:
      throw new Error("Unsupported platform");
  }
}
