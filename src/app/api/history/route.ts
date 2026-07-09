import { db } from "@/db";
import { downloadLogs } from "@/db/schema";
import { desc, eq, and, gte, lte } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET - Get download history with optional filters
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const success = searchParams.get("success");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const conditions = [];
    
    if (platform) {
      conditions.push(eq(downloadLogs.platform, platform));
    }
    
    if (success !== null) {
      conditions.push(eq(downloadLogs.success, success === "true"));
    }

    const whereClause = conditions.length > 0 
      ? and(...conditions) 
      : undefined;

    const history = await db.select()
      .from(downloadLogs)
      .where(whereClause)
      .orderBy(desc(downloadLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const countResult = await db.select({ count: downloadLogs.id })
      .from(downloadLogs)
      .where(whereClause);

    return NextResponse.json({
      success: true,
      history,
      total: countResult.length,
      limit,
      offset
    });
  } catch (error) {
    console.error("Error fetching history:", error);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}

// DELETE - Clear specific history or all
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const all = searchParams.get("all");

  try {
    if (all === "true") {
      // Delete all history
      await db.delete(downloadLogs);
      return NextResponse.json({ success: true, message: "All history cleared" });
    }

    if (platform) {
      // Delete history for specific platform
      await db.delete(downloadLogs).where(eq(downloadLogs.platform, platform));
      return NextResponse.json({ success: true, message: `${platform} history cleared` });
    }

    return NextResponse.json({ 
      error: "Please specify 'platform' or 'all=true' parameter" 
    }, { status: 400 });
  } catch (error) {
    console.error("Error clearing history:", error);
    return NextResponse.json({ error: "Failed to clear history" }, { status: 500 });
  }
}

// POST - Add manual history entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { platform, url, fileName, fileSize, success = true, error: errorMsg } = body;

    if (!platform || !url) {
      return NextResponse.json({ error: "Platform and URL are required" }, { status: 400 });
    }

    const result = await db.insert(downloadLogs).values({
      platform,
      url,
      fileName: fileName || null,
      fileSize: fileSize || null,
      success,
      error: errorMsg || null,
    }).returning();

    return NextResponse.json({ success: true, entry: result[0] });
  } catch (error) {
    console.error("Error creating history entry:", error);
    return NextResponse.json({ error: "Failed to create history entry" }, { status: 500 });
  }
}