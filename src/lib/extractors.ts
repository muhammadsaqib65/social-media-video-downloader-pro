import ytdl from "ytdl-core";
import type { Platform } from "@/lib/platform";
import { sanitizeFileName } from "@/lib/platform";

export type ExtractedVideo = {
  platform: Platform;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  sourceUrl: string;
  downloadUrl: string;
  fileName: string;
};

function getAuthorName(author: unknown): string {
  if (typeof author === "string") return author;
  if (author && typeof author === "object" && "name" in author) {
    return String((author as { name?: string }).name || "Unknown");
  }
  return "Unknown";
}

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
    throw new Error("Could not fetch TikTok video info. Check the URL and try again.");
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
    // Direct stream URL is resolved by third-party providers; keep source for client download flow
    downloadUrl: url,
    fileName: `${sanitizeFileName(title)}.mp4`,
  };
}

export async function extractInstagram(url: string): Promise<ExtractedVideo> {
  // Prefer oEmbed when available; fall back to minimal metadata if blocked
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
  if (!ytdl.validateURL(url)) {
    throw new Error("Invalid YouTube URL");
  }

  const info = await ytdl.getInfo(url);
  const title = info.videoDetails.title || "YouTube Video";
  const videoId = info.videoDetails.videoId;
  const duration = parseInt(info.videoDetails.lengthSeconds || "0", 10) || 0;
  const author = getAuthorName(info.videoDetails.author);
  const thumbnail =
    info.videoDetails.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url ||
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  let downloadUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const format = ytdl.chooseFormat(info.formats, {
      quality: "highest",
      filter: "videoandaudio",
    });
    if (format?.url) {
      downloadUrl = format.url;
    }
  } catch {
    // keep watch URL as fallback
  }

  return {
    platform: "youtube",
    title,
    author,
    thumbnail,
    duration,
    sourceUrl: url,
    downloadUrl,
    fileName: `${sanitizeFileName(title)}.mp4`,
  };
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
