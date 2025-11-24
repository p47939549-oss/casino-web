'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Withdraw = {
  id: string;
  user_id: string;
  amount_micro: number | null; // 可能為 null
  amount?: number | null;      // 可能存在整數 USDT
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  payout_info: string | null;
};

function fmtToken(n: number) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export default function AdminWithdrawalsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [items, setItems] = useState<Withdraw[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg('載入中…');

      // 取得登入者
      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes.user;
      if (!user) {
        setMsg('尚未登入');
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      setReviewerId(user.id);

      // 檢查是否 admin
      const { data: prof } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      const admin = prof?.role === 'admin';
      setIsAdmin(admin);
      if (!admin) {
        setMsg('你不是管理員。');
        setLoading(false);
        return;
      }

      // 讀取 pending 申請（同時帶出 amount_micro 與 amount，兩者擇一顯示）
      const { data, error } = await supabase
  .schema('public')
  .from('api_withdraw_requests')  // ← 換成新 View
  .select('id,user_id,amount_micro,amount,status,created_at,payout_info')
  .eq('status', 'pending')
  .order('created_at', { ascending: true })
  .limit(50);


      if (error) {
        setMsg('讀取失敗：' + error.message);
      } else {
        setItems((data ?? []) as Withdraw[]);
        setMsg(null);
      }
      setLoading(false);
    })();
  }, []);

  // 顯示金額（Token）：有 amount_micro 用 micro→Token；否則用整數 USDT 的 amount
  function displayAmountToken(w: Withdraw) {
    if (w.amount_micro != null) return fmtToken(w.amount_micro / 1_000_000);
    if (w.amount != null) return fmtToken(w.amount); // 這裡 amount 已是整數 USDT
    return '0';
  }

  async function approve(id: string) {
    if (!reviewerId) return;
    setMsg('處理中…');
    // 直接呼叫 approve_withdraw_request：會把（amount_micro 或 amount*1e6）從 balances 扣除
    const { error } = await supabase.rpc('approve_withdraw_request', {
      p_request_id: id,
      p_reviewer_id: reviewerId,
    });
    if (error) {
      setMsg('批准失敗：' + error.message);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
    setMsg(null);
  }

  async function reject(id: string) {
    setMsg('處理中…');
    // 暫時沿用你現有的 review_withdraw 來標記 rejected（不動餘額）
    const { error } = await supabase.rpc('review_withdraw', { p_wd_id: id, p_action: 'reject' });
    if (error) {
      setMsg('拒絕失敗：' + error.message);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
    setMsg(null);
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-black text-white">載入中…</div>;
  }

  if (!isAdmin) {
    return <div className="min-h-screen flex items-center justify-center bg-black text-white">{msg}</div>;
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">提現審核（待審）</h1>
        {msg && <p className="text-yellow-400">{msg}</p>}

        {items.length === 0 ? (
          <p className="text-zinc-400">目前沒有待審申請。</p>
        ) : (
          items.map((w) => (
            <div key={w.id} className="rounded-xl border border-zinc-800 p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="text-sm text-zinc-400">用戶</div>
                  <div className="font-mono">{w.user_id}</div>
                </div>
                <div>
                  <div className="text-sm text-zinc-400">金額</div>
                  <div className="font-semibold">{displayAmountToken(w)} Token</div>
                </div>
                <div>
                  <div className="text-sm text-zinc-400">時間</div>
                  <div>{new Date(w.created_at).toLocaleString()}</div>
                </div>
              </div>

              {w.payout_info && (
                <div className="mt-2 text-sm text-zinc-300 break-words">
                  收款資訊：{w.payout_info}
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => approve(w.id)}
                  className="rounded-lg px-3 py-2 bg-green-600 hover:bg-green-500"
                >
                  批准並扣款
                </button>
                <button
                  onClick={() => reject(w.id)}
                  className="rounded-lg px-3 py-2 bg-zinc-800 hover:bg-zinc-700"
                >
                  拒絕
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
} 