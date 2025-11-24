// lib/support.ts
import { supabase } from "@/lib/supabase";

export type SupportSession = {
  id: string;
  user_id: string;
  status: string | null;
  created_at: string;
};

export type SupportMessage = {
  id: number;
  session_id: string;
  sender_role: "user" | "admin" | "system";
  sender_user_id: string | null;
  content: string;
  created_at: string;
};

// 取得或建立使用者自己的 session（1人 1 個）
export async function getOrCreateMySupportSession() {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("not logged-in");

  const { data: s } = await supabase
    .from("support_sessions")
    .select("id")
    .eq("user_id", uid)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (s?.id) return s.id;

  const { data: inserted, error } = await supabase
    .from("support_sessions")
    .insert([{ user_id: uid, status: "open" }])
    .select("id")
    .single();

  if (error) throw error;
  return inserted!.id as string;
}

// 載入該 session 歷史訊息
export async function fetchMessages(sessionId: string) {
  const { data, error } = await supabase
    .from("support_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as SupportMessage[];
}

// 送出一則使用者訊息
export async function sendUserMessage(sessionId: string, content: string) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id!;
  const { error } = await supabase.from("support_messages").insert([
    {
      session_id: sessionId,
      sender_role: "user",
      sender_user_id: uid,
      content,
    },
  ]);
  if (error) throw error;
}
