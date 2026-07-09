import {
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

// Primary downloads table used by API routes
export const downloads = pgTable("downloads", {
  id: serial("id").primaryKey(),
  platform: varchar("platform", { length: 20 }).notNull(),
  url: text("url").notNull(),
  title: varchar("title", { length: 500 }),
  author: varchar("author", { length: 255 }),
  thumbnail: text("thumbnail"),
  downloadUrl: text("download_url"),
  fileName: varchar("file_name", { length: 255 }),
  fileSize: integer("file_size"),
  success: boolean("success").notNull().default(true),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Backwards-compatible alias for older imports
export const downloadLogs = downloads;

export type Download = typeof downloads.$inferSelect;
export type NewDownload = typeof downloads.$inferInsert;
export type DownloadLog = Download;
export type NewDownloadLog = NewDownload;
