"use client";
import { useEffect, useState } from "react";
import { timeAgo } from "../lib/format.ts";

/**
 * Relative time. The server renders it against its own clock; the client re-renders once on
 * mount so a cached page doesn't say "now" an hour later.
 */
export function Timestamp({ iso }: { iso: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const date = new Date(iso);
  return (
    <time dateTime={iso} title={date.toUTCString()} suppressHydrationWarning>
      {timeAgo(date, now ?? new Date())}
    </time>
  );
}
