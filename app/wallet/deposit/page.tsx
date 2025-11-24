'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Header from '../../components/Header'; // 調整路徑

type DepositRow = {
  id: string;
  amount: number;              // 若你是 other name，這裡改掉
  note: string | null;
  status: string;
  created_at: string;
};

export default function DepositPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>(''); // token 單位
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [list, setList] = useState<DepositRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        window.location.href = '/login';
        return;
      }
      setUserId(data.user.id);
      await loadMyDeposits(data.user.id);
    })();
  }, []);

  async function loadMyDeposits(uid: string) {
    const { data, error } = await supabase
      .from('deposit_requests')
      .select('id, amount, note, status, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      return;
    }
    setList((data ?? []) as any);
  }

  async function submit() {
    const n = Number(amount);
    if (!userId || !n || n <= 0) {
      setMsg('請輸入正確的 Token 金額');
      return;
    }
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.from('deposit_requests').insert({
      user_id: userId,
      amount: n,          // ← 改成你的實際欄位
      note: note || null, // ← 改成你的實際欄位
      status: 'pending',
    });
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setAmount('');
    setNote('');
    await loadMyDeposits(userId);
    setMsg('已送出儲值申請，請等候審核。');
  }

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-56px)] bg-black text-white">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <h1 className="text-2xl font-semibold">儲值</h1>

          <div className="mt-6 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              placeholder="金額（Token），例如 100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              placeholder="備註（可填匯款帳號 / 後 5 碼等）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <button
              onClick={submit}
              disabled={loading}
              className="w-full rounded-lg bg-yellow-500/90 px-3 py-2 font-semibold text-black hover:bg-yellow-500 disabled:opacity-50"
            >
              {loading ? '送出中…' : '送出儲值申請'}
            </button>
            {msg && <div className="text-sm text-yellow-400">{msg}</div>}
          </div>

          <h2 className="mt-8 mb-3 text-lg font-semibold">我的儲值申請</h2>
          <div className="space-y-3">
            {list.map((r) => (
              <div key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-sm">金額：{r.amount} Token</div>
                {r.note && <div className="mt-1 text-sm text-zinc-400">備註：{r.note}</div>}
                <div className="mt-1 text-xs text-zinc-400">
                  狀態：{r.status}　·　{new Date(r.created_at).toLocaleString()}
                </div>
              </div>
            ))}
            {!list.length && <div className="text-sm text-zinc-500">尚無申請紀錄</div>}
          </div>
        </div>
      </main>
    </>
  );
}
