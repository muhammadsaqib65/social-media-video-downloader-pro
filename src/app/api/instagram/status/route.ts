import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const hasCookie = Boolean(
    process.env.INSTAGRAM_COOKIE?.trim() || process.env.IG_SESSIONID?.trim()
  );
  const hasRapidApi = Boolean(process.env.RAPIDAPI_KEY?.trim());

  return NextResponse.json({
    ok: true,
    instagram: {
      cookieConfigured: hasCookie,
      rapidApiConfigured: hasRapidApi,
      ready: hasCookie || hasRapidApi,
      setup: hasCookie
        ? "INSTAGRAM_COOKIE detected"
        : "Add INSTAGRAM_COOKIE in Vercel env for reliable Instagram downloads",
      howTo: [
        "Open instagram.com in Chrome and log in",
        "Press F12 → Network tab",
        "Click any request to instagram.com",
        "Copy the full cookie request header value",
        "In Vercel → Project → Settings → Environment Variables create INSTAGRAM_COOKIE",
        "Paste cookie value, save, then Redeploy",
      ],
    },
  });
}
