'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';

type ChatMessage = {
  id: string;
  from: 'system' | 'user' | 'admin';
  text: string;
  ts: number;
};

function formatAmountFromMicro(micro: number | null | undefined) {
  const v = typeof micro === 'number' ? micro : 0;
  return (v / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// LocalStorage keys
const LS_OPEN_KEY = 'support.open';
const LS_SESSION_KEY = 'support.session_id';

// ====== 取保證只有 1 個未關閉的會話（有則回傳、無則建立）======
async function ensureOpenSession(userId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('ensure_open_support_session', {
    p_user_id: userId,
  });
  if (error) {
    console.error('ensure_open_support_session failed:', error);
    return null;
  }
  return data as string;
}

async function endSession(sessionId: string) {
  await supabase.from('support_sessions').update({ status: 'closed' }).eq('id', sessionId);
}

// Modal Portal
function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

export default function Header() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // === 讀 balances.amount_micro ===
  const [balanceMicro, setBalanceMicro] = useState<number>(0);
  const [loadingBal, setLoadingBal] = useState<boolean>(false);
  const balanceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // 客服彈窗
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'countdown' | 'chat'>('countdown');
  const [count, setCount] = useState(0);

  // 聊天區
  const [nickname, setNickname] = useState<string>('訪客');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 會話
  const [sessionId, setSessionId] = useState<string | null>(null);
  const msgChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // 會話是否已被關閉
  const [sessionClosed, setSessionClosed] = useState(false);
  const closedAnnouncedRef = useRef(false);

  // NEW: 訊息去重（記錄已顯示的 message id）
  const seenIdsRef = useRef<Set<string>>(new Set());

  // 進站：抓使用者 / 暱稱 / 餘額 + 復原彈窗與會話（僅未結束）
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user ?? null;
      setEmail(user?.email ?? null);
      setUserId(user?.id ?? null);

      if (user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('user_id', user.id)
          .maybeSingle();
        if (prof?.display_name) setNickname(prof.display_name);
        else if (user.email) setNickname(user.email);

        try {
          await supabase.rpc('ensure_user_initialized');
        } catch {}

        setLoadingBal(true);
        try {
          const { data: balRow } = await supabase
            .from('balances')
            .select('amount_micro')
            .eq('user_id', user.id)
            .maybeSingle();
          setBalanceMicro(balRow?.amount_micro ?? 0);
        } finally {
          setLoadingBal(false);
        }
      }

      const wasOpen = localStorage.getItem(LS_OPEN_KEY) === '1';
      const sid = localStorage.getItem(LS_SESSION_KEY);
      if (wasOpen) setOpen(true);

      if (sid) {
        const { data: s } = await supabase
          .from('support_sessions')
          .select('status')
          .eq('id', sid)
          .maybeSingle();

        if (s && s.status !== 'closed') {
          setSessionId(sid);
          setPhase('chat');
          setSessionClosed(false);
          await loadHistory(sid);
        } else {
          localStorage.removeItem(LS_SESSION_KEY);
          setSessionClosed(false);
        }
      }
    })();
  }, []);

  // Realtime：監聽 balances
  useEffect(() => {
    if (!userId) return;
    if (balanceChannelRef.current) {
      supabase.removeChannel(balanceChannelRef.current);
      balanceChannelRef.current = null;
    }
    const channel = supabase
      .channel(`balances:user:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'balances', filter: `user_id=eq.${userId}` },
        (payload) => {
          // @ts-ignore
          const next = payload.new?.amount_micro ?? payload.record?.amount_micro ?? 0;
          setBalanceMicro(next);
        }
      )
      .subscribe();
    balanceChannelRef.current = channel;
    return () => {
      if (channel) supabase.removeChannel(channel);
      balanceChannelRef.current = null;
    };
  }, [userId]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  // 讀取某個 session 的歷史訊息（並初始化去重集合）
  async function loadHistory(sid: string) {
    const { data, error } = await supabase
      .from('support_messages')
      .select('id, sender_role, content, created_at')
      .eq('session_id', sid)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadHistory error:', error);
      return;
    }
    const list: ChatMessage[] = (data ?? []).map((r) => ({
      id: String(r.id),
      from: (r.sender_role as any) ?? 'system',
      text: r.content ?? '',
      ts: new Date(r.created_at as any).getTime(),
    }));

    // NEW: 初始化已看過的 id 集合
    seenIdsRef.current = new Set(list.map((r) => r.id));

    setMessages(list);
  }

  // 點擊「客服」：顯示倒數 → 自動進入聊天（用 RPC 確保單一開啟）
  async function handleSupport() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      window.location.href = '/login';
      return;
    }

    setOpen(true);
    localStorage.setItem(LS_OPEN_KEY, '1');

    const sidInLS = localStorage.getItem(LS_SESSION_KEY);
    if (sidInLS) {
      const { data: s } = await supabase
        .from('support_sessions')
        .select('status')
        .eq('id', sidInLS)
        .maybeSingle();

      if (s && s.status !== 'closed') {
        setPhase('chat');
        setSessionId(sidInLS);
        setSessionClosed(false);
        await loadHistory(sidInLS);
        return;
      } else {
        localStorage.removeItem(LS_SESSION_KEY);
      }
    }

    setMessages([]);
    setInput('');
    setSessionClosed(false);
    closedAnnouncedRef.current = false;

    setPhase('countdown');
    const seconds = Math.floor(Math.random() * 8) + 3;
    setCount(seconds);

    const timer = setInterval(async () => {
      setCount((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(timer);
          setPhase('chat');
          setMessages((m) => [
            ...m,
            {
              id: crypto.randomUUID(),
              from: 'system',
              text: '客服已連線，請問需要什麼協助？（可點下方便捷按鈕）',
              ts: Date.now(),
            },
          ]);

          (async () => {
            if (!data.user) return;
            const ensured = await ensureOpenSession(data.user.id);
            if (ensured) {
              setSessionId(ensured);
              localStorage.setItem(LS_SESSION_KEY, ensured);
              await loadHistory(ensured);
              setSessionClosed(false);
            } else {
              setMessages((m) => [
                ...m,
                {
                  id: crypto.randomUUID(),
                  from: 'system',
                  text: '目前暫時無法建立會話，請稍後再試。',
                  ts: Date.now(),
                },
              ]);
            }
          })();
        }
        return next;
      });
    }, 1000);
  }

  // 訂閱這個 session 的狀態（被客服結束時立刻鎖住輸入）
  useEffect(() => {
    if (!sessionId) return;

    (async () => {
      const { data } = await supabase
        .from('support_sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle();
      if (data?.status === 'closed') {
        setSessionClosed(true);
        if (!closedAnnouncedRef.current) {
          setMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), from: 'system', text: '此會話已被客服結束。', ts: Date.now() },
          ]);
          closedAnnouncedRef.current = true;
        }
      } else {
        setSessionClosed(false);
        closedAnnouncedRef.current = false;
      }
    })();

    const sessionCh = supabase
      .channel(`support_sessions:${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'support_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          // @ts-ignore
          const status = payload.new?.status as string | undefined;
          if (status === 'closed') {
            setSessionClosed(true);
            if (!closedAnnouncedRef.current) {
              setMessages((m) => [
                ...m,
                { id: crypto.randomUUID(), from: 'system', text: '此會話已被客服結束。', ts: Date.now() },
              ]);
              closedAnnouncedRef.current = true;
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sessionCh);
    };
  }, [sessionId]);

  // 訂閱這個 session 的新訊息（客服回覆）—加上去重
  useEffect(() => {
    if (!sessionId) return;

    if (msgChannelRef.current) {
      supabase.removeChannel(msgChannelRef.current);
      msgChannelRef.current = null;
    }

    const ch = supabase
      .channel(`support_messages:client:${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new as any;

          // 忽略自己剛送出的 user 訊息（已做 optimistic update）
          if (row.sender_role === 'user') return;

          const key = String(row.id);
          // NEW: 去重—同 id 不再加入
          if (seenIdsRef.current.has(key)) return;
          seenIdsRef.current.add(key);

          setMessages((prev) => [
            ...prev,
            {
              id: key,
              from: (row.sender_role ?? 'system') as 'admin' | 'system' | 'user',
              text: row.content ?? '',
              ts: new Date(row.created_at).getTime(),
            },
          ]);
        }
      )
      .subscribe();

    msgChannelRef.current = ch;
    return () => {
      if (ch) supabase.removeChannel(ch);
      msgChannelRef.current = null;
    };
  }, [sessionId]);

  // 送出訊息（寫入 DB + optimistic）
  async function sendMessage() {
    const text = input.trim();
    if (!text || !userId) return;
    if (!sessionId) {
      console.warn('No session id, cannot send message');
      return;
    }
    if (sessionClosed) {
      setInput('');
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          from: 'system',
          text: '此會話已結束，請重新開啟客服以建立新會話。',
          ts: Date.now(),
        },
      ]);
      return;
    }

    setInput('');
    setMessages((m) => [...m, { id: crypto.randomUUID(), from: 'user', text, ts: Date.now() }]);

    const { error } = await supabase.from('support_messages').insert({
      session_id: sessionId,
      sender_user_id: userId,
      sender_role: 'user',
      content: text,
    });
    if (error) console.error('送出訊息失敗:', error);
  }

  // 捲到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' });
  }, [messages, open, phase]);

  function closeChat() {
    setOpen(false);
    localStorage.removeItem(LS_OPEN_KEY);
  }

  // 結束對話按鈕
  async function handleEndChat() {
    if (sessionId) {
      await endSession(sessionId);
    }
    localStorage.removeItem(LS_SESSION_KEY);
    setSessionClosed(true);
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), from: 'system', text: '您已結束本次會話。', ts: Date.now() },
    ]);
  }

  const headerRight = useMemo(() => {
    return email ? (
      <>
        <span className="rounded-lg px-2 py-1 border border-zinc-800 bg-zinc-900 text-zinc-200">
          餘額：{loadingBal ? '…' : `${formatAmountFromMicro(balanceMicro)} USDT`}
        </span>
        <Link href="/me" className="hover:text-yellow-400">個人中心</Link>
        <Link href="/wallet/deposit" className="hover:text-yellow-400">儲值</Link>
        <Link href="/wallet/withdraw" className="hover:text-yellow-400">提現</Link>
        <button
          onClick={signOut}
          className="rounded-lg px-2 py-1 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800"
        >
          登出
        </button>
      </>
    ) : (
      <>
        <Link href="/login" className="hover:text-yellow-400">登入</Link>
        <Link href="/register" className="hover:text-yellow-400">註冊</Link>
      </>
    );
  }, [email, loadingBal, balanceMicro]);

  return (
    <>
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Link href="/" className="font-semibold">Casino MVP</Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/games" className="hover:text-yellow-400">遊戲</Link>
            <button
              onClick={handleSupport}
              className="rounded-lg px-2 py-1 bg-yellow-500/90 hover:bg-yellow-500 text-black font-semibold"
            >
              客服
            </button>
            {headerRight}
          </nav>
        </div>
      </header>

      {open && (
        <ModalPortal>
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70">
            <div className="w-[92%] max-w-md rounded-2xl border border-zinc-700 bg-zinc-900">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <div className="font-semibold">
                  客服中心 {phase === 'chat' ? `— ${nickname}` : ''}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleEndChat}
                    className="rounded-full px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700"
                  >
                    結束對話
                  </button>
                  <button
                    onClick={closeChat}
                    className="text-zinc-400 hover:text-white"
                    aria-label="close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {phase === 'countdown' ? (
                <div className="px-5 py-6">
                  <div className="mb-2 text-lg font-semibold">客服忙線中，請不要離開</div>
                  <p className="text-zinc-300">我們正在為您安排客服人員…（{count}s）</p>
                </div>
              ) : (
                <div className="flex flex-col h-[460px]">
                  <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {messages.map((m) => (
                      <div key={m.id} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                            m.from === 'user'
                              ? 'bg-yellow-500 text-black'
                              : m.from === 'system'
                              ? 'bg-zinc-800 text-zinc-200'
                              : 'bg-zinc-700 text-white'
                          }`}
                        >
                          {m.text}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="px-4 pb-2 flex gap-2">
                    <button
                      className="rounded-full px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700"
                      onClick={() => setInput('我要儲值')}
                      disabled={sessionClosed}
                    >
                      我要儲值
                    </button>
                    <button
                      className="rounded-full px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700"
                      onClick={() => setInput('我要提現')}
                      disabled={sessionClosed}
                    >
                      我要提現
                    </button>
                  </div>

                  <div className="flex gap-2 border-t border-zinc-800 p-3">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !sessionClosed && sendMessage()}
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm disabled:opacity-60"
                      placeholder={sessionClosed ? '此會話已結束' : '請輸入訊息…'}
                      disabled={sessionClosed}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={sessionClosed}
                      className="rounded-lg bg-yellow-500/90 px-3 py-2 font-semibold text-black hover:bg-yellow-500 disabled:opacity-60"
                    >
                      送出
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
