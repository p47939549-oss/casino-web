'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

type SessionRow = {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  display_name?: string | null;
  // 可用於排序（用訊息時間把會話頂上），沒有也不影響
  last_message_at?: string | null;
};

type MessageRow = {
  id: string | number;
  session_id: string;
  sender_role: 'user' | 'admin' | 'system';
  sender_user_id: string | null;
  content: string;
  created_at: string;
};

export default function AdminSupportPage() {
  const [meIsAdmin, setMeIsAdmin] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // 🔹為了讓 Realtime handler 拿到最新 activeId，用 ref 同步
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // ========== 權限：只有 admin 可進 ==========
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        window.location.href = '/login';
        return;
      }
      const { data: prof } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', auth.user.id)
        .maybeSingle();

      const ok = prof?.role === 'admin';
      setMeIsAdmin(ok);
      if (!ok) window.location.href = '/';
    })();
  }, []);

  // ========== 載入會話清單（避免 N+1） ==========
  async function fetchSessions() {
    // 把你需要的欄位一次抓回來（可加上 last_message_at 如果你表裡有）
    const { data, error } = await supabase
      .from('support_sessions')
      .select('id,user_id,status,created_at,last_message_at')
      .order('last_message_at', { ascending: false, nullsFirst: false }) // 沒有欄位也不會壞，或改用 created_at
      .order('created_at', { ascending: false });

    if (error) {
      console.error('fetchSessions error:', error);
      return;
    }

    const rows = (data ?? []) as SessionRow[];

    // 一次把所有 user_id 的 display_name 撈回來
    const userIds = Array.from(new Set(rows.map(r => r.user_id)));
    let displayMap = new Map<string, string | null>();
    if (userIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id,display_name')
        .in('user_id', userIds);
      for (const p of profs ?? []) {
        displayMap.set(p.user_id, p.display_name ?? null);
      }
    }

    const merged = rows.map(s => ({
      ...s,
      display_name: displayMap.get(s.user_id) ?? null,
    }));

    setSessions(merged);
    // 若沒有選中會話，就選第一個
    if (!activeIdRef.current && merged.length) setActiveId(merged[0].id);
  }

  // 初次載入會話清單
  useEffect(() => {
    if (meIsAdmin !== true) return;
    fetchSessions();
  }, [meIsAdmin]);

  // ========== 載入訊息 + Realtime（訊息） ==========
  useEffect(() => {
    if (!activeId) return;

    let mounted = true;

    (async () => {
      const { data, error } = await supabase
        .from('support_messages')
        .select('id,session_id,sender_role,sender_user_id,content,created_at')
        .eq('session_id', activeId)
        .order('created_at', { ascending: true });

      if (!error && mounted) setMessages((data ?? []) as MessageRow[]);
    })();

    const ch = supabase
      .channel(`support_messages:${activeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `session_id=eq.${activeId}` },
        (payload) => {
          const row = payload.new as MessageRow;
          // 避免自己(admin)剛送出的訊息重複加入（send() 已經樂觀更新）
          if (row.sender_role === 'admin') return;
          setMessages(m => [...m, row]);
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [activeId]);

  // ========== Realtime：會話清單（新會話、會話更新） & 新訊息頂上列表 ==========
  useEffect(() => {
    if (meIsAdmin !== true) return;

    // 新增 / 更新 support_sessions
    const sessCh = supabase
      .channel('admin:support_sessions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_sessions' },
        async (payload) => {
          const s = payload.new as SessionRow;
          // 補上 display_name
          let displayName: string | null = null;
          const { data: prof } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('user_id', s.user_id)
            .maybeSingle();
          displayName = prof?.display_name ?? null;

          setSessions(prev => {
            // 避免重覆加同一筆
            if (prev.some(p => p.id === s.id)) return prev;
            const row: SessionRow = { ...s, display_name: displayName };
            // 新會話頂到最前面
            return [row, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'support_sessions' },
        (payload) => {
          const s = payload.new as SessionRow;
          setSessions(prev =>
            prev.map(p =>
              p.id === s.id ? { ...p, status: s.status, created_at: s.created_at, last_message_at: s.last_message_at ?? p.last_message_at ?? null } : p
            )
          );
        }
      )
      .subscribe();

    // 新訊息進來時，把該會話頂到最上面，並在當前會話時追加訊息
    const msgCh = supabase
      .channel('admin:support_messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages' },
        async (payload) => {
          const m = payload.new as MessageRow;

          // 頂上列表（用 last_message_at 或直接移動）
          setSessions(prev => {
            const idx = prev.findIndex(s => s.id === m.session_id);
            if (idx === -1) {
              // 不在清單：保險起見重抓一次
              fetchSessions();
              return prev;
            }
            const copy = [...prev];
            const session = copy.splice(idx, 1)[0];
            const bumped: SessionRow = {
              ...session,
              last_message_at: m.created_at,
            };
            return [bumped, ...copy];
          });

          // 如果此訊息屬於當前開啟的會話，且不是 admin 自己送的，直接加到右側訊息
          if (activeIdRef.current === m.session_id && m.sender_role !== 'admin') {
            setMessages(prev => [...prev, m]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sessCh);
      supabase.removeChannel(msgCh);
    };
  }, [meIsAdmin]);

  // ========== 送出訊息（admin）— 楽觀更新 ==========
  async function send() {
    const text = input.trim();
    if (!text || !activeId) return;

    // 若已關閉，直接不送
    const current = sessions.find((s) => s.id === activeId);
    if (current?.status === 'closed') return;

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        session_id: activeId,
        sender_role: 'admin',
        sender_user_id: auth.user.id,
        content: text,
      })
      .select('id,session_id,sender_role,sender_user_id,content,created_at')
      .single();

    if (error) {
      console.error('send message error:', error);
      return;
    }

    // 樂觀更新訊息
    setMessages(prev => [...prev, data as any]);

    // 把該會話頂上（也更新 last_message_at）
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === activeId);
      if (idx === -1) return prev;
      const copy = [...prev];
      const s = copy.splice(idx, 1)[0];
      const bumped: SessionRow = { ...s, last_message_at: (data as any).created_at };
      return [bumped, ...copy];
    });

    setInput('');
  }

  // ========== 結束會話 ==========
  async function endActiveSession() {
    if (!activeId) return;
    const { error } = await supabase
      .from('support_sessions')
      .update({ status: 'closed' })
      .eq('id', activeId);

    if (error) {
      console.error('end session error:', error);
      return;
    }

    setSessions((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, status: 'closed' } : s))
    );
  }

  // 捲到底
  useEffect(() => {
    listRef.current?.scrollTo({ top: 9e9, behavior: 'smooth' });
  }, [messages, activeId]);

  if (meIsAdmin !== true) {
    return <div className="min-h-screen bg-black text-white p-6">檢查權限中…</div>;
  }

  const active = sessions.find((s) => s.id === activeId);
  const isClosed = active?.status === 'closed';

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-4">
        <div className="font-semibold">客服後台</div>
        <Link href="/" className="text-sm hover:text-yellow-400">回前台</Link>
      </div>

      <div className="grid grid-cols-12 gap-0">
        {/* 左側：會話清單 */}
        <aside className="col-span-3 border-r border-zinc-800 h-[calc(100vh-56px)] overflow-y-auto">
          <div className="p-3 text-sm text-zinc-400">所有會話</div>
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={`w-full text-left px-3 py-3 hover:bg-zinc-900 border-b border-zinc-900 ${
                s.id === activeId ? 'bg-zinc-900' : ''
              }`}
            >
              <div className="text-sm font-medium flex items-center gap-2">
                {s.display_name || s.user_id.slice(0, 8)}
                {s.status === 'closed' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700">
                    closed
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-400 mt-1">
                狀態：{s.status} · {new Date(s.created_at).toLocaleString()}
              </div>
            </button>
          ))}
        </aside>

        {/* 中間：訊息視窗 */}
        <main className="col-span-6 h-[calc(100vh-56px)] flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <div className="font-semibold">
                {active ? (active.display_name || active.user_id) : '—'}
              </div>
              <div className="text-xs text-zinc-400">會話 ID：{activeId ?? '—'}</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={endActiveSession}
                disabled={!activeId || isClosed}
                className="rounded-full px-3 py-1 text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50"
              >
                結束會話
              </button>
            </div>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender_role === 'admin' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
                    m.sender_role === 'admin'
                      ? 'bg-yellow-500 text-black'
                      : m.sender_role === 'system'
                      ? 'bg-zinc-800 text-zinc-200'
                      : 'bg-zinc-700 text-white'
                  }`}
                >
                  {m.content}
                  <div className="mt-1 text-[10px] opacity-70">
                    {new Date(m.created_at).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-800 p-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isClosed && send()}
              placeholder={isClosed ? '此會話已結束' : '輸入回覆內容…'}
              disabled={isClosed}
              className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm disabled:opacity-60"
            />
            <button
              onClick={send}
              disabled={isClosed}
              className="rounded-lg px-3 py-2 bg-yellow-500/90 hover:bg-yellow-500 text-black font-semibold disabled:opacity-60"
            >
              送出
            </button>
          </div>
        </main>

        {/* 右側：聯絡資料／快捷 */}
        <aside className="col-span-3 border-l border-zinc-800 h-[calc(100vh-56px)] overflow-y-auto">
          <div className="p-4">
            <div className="font-semibold mb-2">聯絡資料</div>
            {active ? (
              <div className="space-y-2 text-sm">
                <div>暱稱：{active.display_name ?? '—'}</div>
                <div>狀態：{active.status}</div>
                <div>建立時間：{new Date(active.created_at).toLocaleString()}</div>
              </div>
            ) : (
              <div className="text-sm text-zinc-400">尚未選擇會話</div>
            )}

            <div className="mt-6">
              <div className="font-semibold mb-2">便捷操作</div>
              <div className="flex gap-2">
                <button onClick={() => setInput('您好，這裡是客服，很高興為您服務。')} className="rounded-full px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700">招呼</button>
                <button onClick={() => setInput('您要申請「儲值」還是「提現」呢？')} className="rounded-full px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700">儲值/提現</button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
