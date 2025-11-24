'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import Header from '../components/Header'; // ← 依你的實際路徑調整

function toToken(micro: number | null | undefined) {
  if (micro == null) return '0';
  return (micro / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export default function MePage() {
  const [email, setEmail] = useState<string | null>(null);
  const [balanceMicro, setBalanceMicro] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    // 讓我們能在卸載時把訂閱關掉
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      setMsg('載入中…');

      // 1) 登入檢查
      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes.user;
      if (!user) {
        setMsg('尚未登入，請先登入。');
        setEmail(null);
        setBalanceMicro(null);
        return;
      }
      setEmail(user.email ?? null);

      // 2) 初始化
      const { error: initErr } = await supabase.rpc('ensure_user_initialized');
      if (initErr) {
        setMsg('初始化失敗：' + initErr.message);
        return;
      }

      // 3) 讀餘額（第一次載入）＋ 臨時除錯
const { data: bal, error: balErr } = await supabase
  .from('balances')
  .select('user_id, amount_micro, updated_at')  // ← 多抓幾個欄位方便看
  .eq('user_id', user.id)
  .maybeSingle();

console.log('[MePage] user.id =', user.id);
console.log('[MePage] balances row =', bal, 'error =', balErr);

if (balErr) {
  setMsg('讀取餘額失敗：' + balErr.message);
  return;
}

setBalanceMicro(bal?.amount_micro ?? 0);
setMsg(null);


      // 4) ⭐ 監聽該用戶餘額變動（批准提領/儲值後會自動更新）
      channel = supabase
        .channel(`balance:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'balances',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const next = (payload.new as any)?.amount_micro ?? null;
            setBalanceMicro(next);
          }
        )
        .subscribe();
    })();

    // 5) 卸載時關閉訂閱，避免記憶體外洩
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-56px)] bg-black text-white">
        <div className="mx-auto max-w-4xl px-4 py-8">
          <h1 className="text-2xl font-semibold">個人中心</h1>
          <div className="mt-2 text-sm text-zinc-400">目前登入：{email ?? '（未登入）'}</div>

          {/* 餘額 */}
          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
            {msg ? (
              <div className="text-sm text-yellow-400">{msg}</div>
            ) : (
              <>
                <div className="text-sm text-zinc-400">餘額（Token）</div>
                <div className="mt-1 text-3xl font-semibold">{toToken(balanceMicro)}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  （內部記帳：{balanceMicro ?? 0} microToken）
                </div>
              </>
            )}
          </div>

          {/* 快速入口 */}
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Link
              href="/wallet/deposit"
              className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 hover:bg-zinc-900 transition-colors"
            >
              <div className="text-sm text-zinc-400">錢包</div>
              <div className="mt-1 text-xl font-semibold">儲值</div>
              <div className="mt-1 text-xs text-zinc-500">提交儲值申請，客服審核後入帳</div>
            </Link>

            <Link
              href="/wallet/withdraw"
              className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 hover:bg-zinc-900 transition-colors"
            >
              <div className="text-sm text-zinc-400">錢包</div>
              <div className="mt-1 text-xl font-semibold">提現</div>
              <div className="mt-1 text-xs text-zinc-500">填寫收款地址與金額，客服審核後匯出</div>
            </Link>
          </div>

          {/* 其他導覽（可再擴充） */}
          <div className="mt-8 text-sm">
            <Link href="/" className="text-yellow-400 hover:underline">
              ← 回首頁
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
