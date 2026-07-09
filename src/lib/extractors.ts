import type { Platform } from "@/lib/platform";
import { extractInstagram as extractInstagramCore } from "@/lib/instagram";
import { extractTikTok as extractTikTokCore } from "@/lib/tiktok";
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
  mediaUrl?: string;
  qualities?: Array<{
    label: string;
    height: number;
    itag: number;
    hasAudio: boolean;
    container: string;
    approxSize?: number;
    client?: string;
  }>;
  selectedQuality?: string;
  warning?: string;
};

export async function extractTikTok(url: string): Promise<ExtractedVideo> {
  return extractTikTokCore(url);
}

export async function extractInstagram(url: string): Promise<ExtractedVideo> {
  return extractInstagramCore(url);
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
