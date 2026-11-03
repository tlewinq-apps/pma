// src/lib/db/server.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

let svc: SupabaseClient | null = null;
export function serviceDb(): SupabaseClient {
  svc ??= createClient(env.supabaseUrl(), env.supabaseService(), { auth: { persistSession: false } });
  return svc;
}

export async function userDb(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnon(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* server component */ } },
    },
  });
}
