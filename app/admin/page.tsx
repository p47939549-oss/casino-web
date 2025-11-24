'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Counts = {
  depositsPending: number;
  withdrawalsPending: number;
};

export default function AdminHome() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Counts>({ depositsPending: 0, withdrawalsPending: 0 });
  const [msg, setMsg] = useState<string | null>(null);

  // Realtime channels
  const depChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const wdChRef  = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // 統一抓待審數量（依你現在的兩張表）
  async function fetchCounts() {
    // 1) 儲值：使用視圖 admin_pending_deposits 只做 count
    const { count: depCnt, error: depErr } = await supabase
      .from('admin_pending_deposits')
      .select('*', { count: 'exact', head: true });

    // 2) 提領：api_withdraw_requests 僅計 pending
    //   嘗試 status / request_status，不行就以 reviewed_at 為 NULL 當後備
    const tryWR = async (col: 'status' | 'request_status' | null) => {
      const base = supabase
        .from('api_withdraw_requests')
        .select('*', { count: 'exact', head: true });
      return col ? base.eq(col, 'pending') : base.is('reviewed_at', null);
    };

    let wr = await tryWR('status');
    if (wr.error) wr = await tryWR('request_status');
    if (wr.error) wr = await tryWR(null);

    if (depErr) throw new Error('讀取待審儲值失敗：' + depErr.message);
    if (wr.error) throw new Error('讀取待審提領失敗：' + wr.error.message);

    setCounts({
      depositsPending: depCnt ?? 0,
      withdrawalsPending: wr.count ?? 0,
    });
  }

  useEffect(() => {
    (async () => {
      setMsg('載入中…');

      // 1) 檢查登入
      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes.user;
      if (!user) {
        setIsAdmin(false);
        setMsg('尚未登入');
        return;
      }

      // 2) 檢查是否 admin
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profErr) {
        setIsAdmin(false);
        setMsg('讀取角色失敗：' + profErr.message);
        return;
      }

      const admin = prof?.role === 'admin';
      setIsAdmin(admin);
      if (!admin) {
        setMsg('你不是管理員。');
        return;
      }

      // 3) 首次載入
      try {
        await fetchCounts();
        setMsg(null);
      } catch (e: any) {
        setMsg(e?.message ?? '載入失敗');
      }

      // 4) Realtime 訂閱
      // 視圖(admin_pending_deposits)不能訂閱，所以訂在底層 deposit_requests
      if (depChRef.current) {
        supabase.removeChannel(depChRef.current);
        depChRef.current = null;
      }
      depChRef.current = supabase
        .channel('admin:deposits:pending')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'deposit_requests' },
          async () => {
            try { await fetchCounts(); } catch {}
          }
        )
        .subscribe();

      // 提領直接訂 api_withdraw_requests（是表就能訂）
      if (wdChRef.current) {
        supabase.removeChannel(wdChRef.current);
        wdChRef.current = null;
      }
      wdChRef.current = supabase
        .channel('admin:withdrawals:pending')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'api_withdraw_requests' },
          async () => {
            try { await fetchCounts(); } catch {}
          }
        )
        .subscribe();

      // 5) 視窗回到前景時刷新（避免錯過訊息）
      const onVis = () => { if (document.visibilityState === 'visible') fetchCounts().catch(() => {}); };
      document.addEventListener('visibilitychange', onVis);

      // 6) 每 30 秒保險刷新一次（可調整或移除）
      const timer = setInterval(() => { fetchCounts().catch(() => {}); }, 30000);

      // 清理
      return () => {
        document.removeEventListener('visibilitychange', onVis);
        clearInterval(timer);
        if (depChRef.current) supabase.removeChannel(depChRef.current);
        if (wdChRef.current)  supabase.removeChannel(wdChRef.current);
      };
    })();
  }, []);

  if (isAdmin === null) {
    return <div className="min-h-screen flex items-center justify-center bg-black text-white">載入中…</div>;
  }
  if (!isAdmin) {
    return <div className="min-h-screen flex items-center justify-center bg-black text-white">{msg}</div>;
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">管理儀表板</h1>
          <Link href="/" className="underline text-yellow-400">回前台</Link>
        </div>

        {msg && <p className="text-yellow-400">{msg}</p>}

        {/* 指標卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/admin/deposits"
            className="rounded-2xl border border-zinc-800 p-5 hover:border-yellow-500/60"
          >
            <div className="text-sm text-zinc-400">待審儲值</div>
            <div className="text-3xl font-bold mt-1">{counts.depositsPending}</div>
            <div className="text-sm text-zinc-400 mt-2">點擊前往審核</div>
          </Link>

          <Link
            href="/admin/withdrawals"
            className="rounded-2xl border border-zinc-800 p-5 hover:border-yellow-500/60"
          >
            <div className="text-sm text-zinc-400">待審提領</div>
            <div className="text-3xl font-bold mt-1">{counts.withdrawalsPending}</div>
            <div className="text-sm text-zinc-400 mt-2">點擊前往審核</div>
          </Link>
        </div>

        {/* 快速區塊 */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-zinc-800 p-4">
            <div className="font-semibold mb-2">快速操作</div>
            <ul className="text-sm text-zinc-300 space-y-2 list-disc list-inside">
              <li><Link className="underline" href="/admin/deposits">審核儲值申請</Link></li>
              <li><Link className="underline" href="/admin/withdrawals">審核提領申請</Link></li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 p-4">
            <div className="font-semibold mb-2">提示</div>
            <p className="text-sm text-zinc-300">
              這裡只顯示管理員可見的內容。請將此頁加入書籤，不在前台導覽公開連結。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
