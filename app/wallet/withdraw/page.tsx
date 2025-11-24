'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Header from '../../components/Header';

type WithdrawRow = {
  id: string;
  micro?: number | null;          // 可能存在
  amount_micro?: number | null;   // 可能存在（而且有 NOT NULL 約束）
  address: string | null;
  note: string | null;
  status: string;
  created_at: string;
};

function toUSDT(micro: number) {
  return (micro / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function WithdrawPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [amount, setAmount] = useState(''); // 輸入的 USDT（整數）
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [list, setList] = useState<WithdrawRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { window.location.href = '/login'; return; }
      setUserId(data.user.id);
      await loadMyWithdraws(data.user.id);
    })();
  }, []);

  async function loadMyWithdraws(uid: string) {
    const { data, error } = await supabase
      .from('withdraw_requests')
      // 兩個欄位都抓，前端自己做 fallback
      .select('id, micro, amount_micro, address, note, status, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    if (error) { setMsg(error.message); return; }
    setList((data ?? []) as any);
  }

  function validAddress(s: string) {
    return s.trim().length >= 10;
  }

  async function submit() {
    const n = Number(amount);
    if (!userId || !n || n <= 0) { setMsg('請輸入正確的 USDT 金額'); return; }
    if (!validAddress(address)) { setMsg('請輸入正確的錢包地址'); return; }

    const micro = Math.round(n * 1_000_000);

    setLoading(true);
    setMsg(null);

    // 同時寫入 amount、micro、amount_micro，確保任何一邊的 NOT NULL 都不會擋
    const { error } = await supabase.from('withdraw_requests').insert({
      user_id: userId,
      amount: n,                 // 人看得懂
      micro,                     // 你現在表裡的欄位
      amount_micro: micro,       // 舊欄位 / 仍有 NOT NULL 約束
      address: address || null,
      note: note || null,
      status: 'pending',
    } as any);

    setLoading(false);

    if (error) { setMsg(error.message); return; }

    setAmount('');
    setAddress('');
    setNote('');
    await loadMyWithdraws(userId);
    setMsg('已送出提領申請，請等候審核。');
  }

  // 取得可用的 micro 值（micro 優先，沒有就用 amount_micro）
  function getRowMicro(r: WithdrawRow) {
    return (r.micro ?? r.amount_micro ?? 0);
  }

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-56px)] bg-black text-white">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <h1 className="text-2xl font-semibold">提領</h1>

          <div className="mt-6 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              placeholder="金額（USDT），例如 100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              placeholder="收款錢包地址（USDT 鏈）"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              placeholder="備註（選填）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <button
              onClick={submit}
              disabled={loading}
              className="w-full rounded-lg bg-yellow-500/90 px-3 py-2 font-semibold text-black hover:bg-yellow-500 disabled:opacity-50"
            >
              {loading ? '送出中…' : '送出提領申請'}
            </button>
            {msg && <div className="text-sm text-yellow-400">{msg}</div>}
          </div>

          <h2 className="mt-8 mb-3 text-lg font-semibold">我的提領申請</h2>
          <div className="space-y-3">
            {list.map((r) => (
              <div key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-sm">金額：{toUSDT(getRowMicro(r))} USDT</div>
                {r.address && <div className="mt-1 text-sm text-zinc-400">地址：{r.address}</div>}
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
