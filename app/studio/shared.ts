"use client";

import { createClient } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

type StudioClient = NonNullable<typeof supabase>;
export interface Studio {
  client: StudioClient;
  role: string;
  email: string;
  /** Asks the shell to refresh counters shown in the sidebar. */
  refreshCounts: () => void;
}
export const StudioContext = createContext<Studio | null>(null);

/** Pages render only inside the signed-in staff branch of the layout, so the value is always there. */
export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error("studio_context_missing");
  return studio;
}

const TIME = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const RELATIVE = new Intl.RelativeTimeFormat("it-IT", { numeric: "auto" });

export function formatWhen(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const minutes = Math.round((date.getTime() - now) / 60_000);
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, "minute");
  if (Math.abs(minutes) < 24 * 60) return RELATIVE.format(Math.round(minutes / 60), "hour");
  return TIME.format(date);
}

export const usd = (value: number) => `$${value.toFixed(2)}`;
