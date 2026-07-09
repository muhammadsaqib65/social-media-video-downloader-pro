import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Detect platform from URL
function detectPlatform(url: string): 'tiktok' | 'instagram' | 'youtube' | null {
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes('tiktok.com') || lowerUrl.includes('vm.tiktok')) {
    return 'tiktok';
  }
  if (lowerUrl.includes('instagram.com') || lowerUrl.includes('dd.instagram')) {
    return 'instagram';
  }
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
    return 'youtube';
  }
  
  return null;
}

// Extract video info from URL
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    const platform = detectPlatform(url);

    if (!platform) {
      return NextResponse.json({ 
        error: "Unsupported platform. Please provide a TikTok, Instagram, or YouTube URL." 
      }, { status: 400 });
    }

    // Return the detected platform and appropriate download endpoint
    return NextResponse.json({
      success: true,
      platform,
      url,
      downloadEndpoint: `/api/download/${platform}`,
      infoEndpoint: `/api/download/${platform}?url=${encodeURIComponent(url)}`
    });
  } catch (error) {
    console.error("Error extracting video info:", error);
    return NextResponse.json({ error: "Failed to extract video info" }, { status: 500 });
  }
}

// GET - Check if URL is supported
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  const platform = detectPlatform(url);

  return NextResponse.json({
    success: true,
    platform,
    supported: platform !== null,
    message: platform 
      ? `This appears to be a ${platform} URL` 
      : "This URL is not from a supported platform"
  });
}