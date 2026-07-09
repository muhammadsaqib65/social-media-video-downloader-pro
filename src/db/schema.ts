import { pgTable, serial, text, timestamp, varchar, integer, boolean } from "drizzle-orm/pg-core";

// Download logs table to track download history
export const downloadLogs = pgTable("download_logs", {
  id: serial("id").primaryKey(),
  platform: varchar("platform", { length: 20 }).notNull(),
  url: text("url").notNull(),
  fileSize: integer("file_size"),
  fileName: varchar("file_name", { length: 255 }),
  success: boolean("success").notNull().default(true),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Downloads table (alias for backward compatibility)
export const downloads = downloadLogs;

// Users table for authentication (optional future feature)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DownloadLog = typeof downloadLogs.$inferSelect;
export type NewDownloadLog = typeof downloadLogs.$inferInsert;
export type Download = typeof downloads.$inferSelect;
