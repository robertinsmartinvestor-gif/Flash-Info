"use client";

import { createClient } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export const field = { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, marginBottom: 12 } as const;
export const button = { background: "#111", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" } as const;
export const small = { fontSize: 13, color: "#666" } as const;

type StudioClient = NonNullable<typeof supabase>;
export const StudioContext = createContext<{ client: StudioClient; role: string } | null>(null);

/** Pages render only inside the signed-in staff branch of the layout, so the value is always there. */
export function useStudio() {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error("studio_context_missing");
  return studio;
}
