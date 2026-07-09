export type Platform = "tiktok" | "instagram" | "youtube";

export function detectPlatform(url: string): Platform | null {
  const value = url.trim().toLowerCase();

  if (
    /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/.test(value)
  ) {
    return "tiktok";
  }

  if (
    /instagram\.com|instagr\.am/.test(value)
  ) {
    return "instagram";
  }

  if (
    /youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com/.test(value)
  ) {
    return "youtube";
  }

  return null;
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 120) || "video";
}
