'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Deposit = {
  id: string;
  user_id: string;
  amount: number; // 整數 USDT（非 micro）
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  note: string | null;
};

function fmt(n: number) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function AdminDepositsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [items, setItems] = useState<Deposit[]>([]);
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

      // 檢查是否 admin（從 profiles.role）
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

      // 改讀 admin_pending_deposits view
      const { data, error } = await supabase
        .from('admin_pending_deposits')
        .select('id,user_id,amount,status,created_at,note')
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) {
        setMsg('讀取失敗：' + error.message);
      } else {
        setItems((data ?? []) as Deposit[]);
        setMsg(null);
      }
      setLoading(false);
    })();
  }, []);

  async function approve(id: string) {
    if (!reviewerId) return;
    setMsg('處理中…');
    // 新版：直接呼叫 approve_deposit_request，會把 amount * 1e6 加到 balances
    const { error } = await supabase.rpc('approve_deposit_request', {
      p_request_id: id,
      p_reviewer_id: reviewerId,
    });
    if (error) {
      setMsg('批准失敗：' + error.message);
      return;
    }
    // 從列表移除
    setItems((prev) => prev.filter((x) => x.id !== id));
    setMsg(null);
  }

  async function reject(id: string) {
    setMsg('處理中…');
    // 暫時沿用你原本的 review_deposit RPC 來標記 rejected（不影響餘額）
    const { error } = await supabase.rpc('review_deposit', { p_dep_id: id, p_action: 'reject' });
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
        <h1 className="text-2xl font-semibold">儲值審核（待審）</h1>
        {msg && <p className="text-yellow-400">{msg}</p>}

        {items.length === 0 ? (
          <p className="text-zinc-400">目前沒有待審申請。</p>
        ) : (
          items.map((d) => (
            <div key={d.id} className="rounded-xl border border-zinc-800 p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="text-sm text-zinc-400">用戶</div>
                  <div className="font-mono">{d.user_id}</div>
                </div>
                <div>
                  <div className="text-sm text-zinc-400">金額</div>
                  <div className="font-semibold">{fmt(d.amount)} USDT</div>
                </div>
                <div>
                  <div className="text-sm text-zinc-400">時間</div>
                  <div>{new Date(d.created_at).toLocaleString()}</div>
                </div>
              </div>
              {d.note && <div className="mt-2 text-sm text-zinc-300">備註：{d.note}</div>}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => approve(d.id)}
                  className="rounded-lg px-3 py-2 bg-green-600 hover:bg-green-500"
                >
                  批准並加值
                </button>
                <button
                  onClick={() => reject(d.id)}
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
