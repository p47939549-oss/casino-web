'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function Eye({ on, ...p }: any) {
  return (
    <span {...p} className="cursor-pointer text-zinc-400 hover:text-white">
      {on ? '🙈' : '👁️'}
    </span>
  );
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 讀取「記住帳號」
  useEffect(() => {
    const saved = localStorage.getItem('login.email');
    if (saved) setEmail(saved);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    if (remember) localStorage.setItem('login.email', email);
    else localStorage.removeItem('login.email');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    router.push('/me');
  }

  async function sendMagicLink() {
    if (!email) return;
    setLoading(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setLoading(false);
    setMsg(error ? error.message : '已寄出魔術連結，請到信箱點擊登入。');
  }

  return (
    <div className="min-h-screen bg-[url('/auth-bg.jpg')] bg-cover bg-center flex">
      {/* 左側 Banner（可放品牌圖/宣傳） */}
      <div className="hidden md:flex w-[38%] items-end justify-center bg-black/50">
        {/* 需要的話在這裡塞你的品牌區塊或圖片 */}
      </div>

      {/* 右側卡片表單：與註冊頁一致 */}
      <div className="flex-1 flex items-center justify-center p-4">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
          <div className="px-6 pt-6 text-center">
            <div className="text-lg text-yellow-400 font-semibold">Welcome Back!</div>
            <div className="text-xs text-zinc-400 mt-1">請使用你的帳號登入</div>
          </div>

          <div className="p-6 space-y-4">
            {/* 帳號（Email） */}
            <div>
              <label className="block text-sm mb-1 text-zinc-300">* 帳號（Email）</label>
              <input
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-3 text-sm outline-none focus:border-yellow-500"
                placeholder="name@example.com"
                inputMode="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            {/* 密碼 */}
            <div>
              <label className="block text-sm mb-1 text-zinc-300">* 密碼</label>
              <div className="relative flex items-center gap-2">
                <input
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-3 text-sm outline-none focus:border-yellow-500"
                  placeholder="請輸入密碼"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <Eye on={showPwd} onClick={() => setShowPwd((s: boolean) => !s)} />
              </div>
            </div>

            {/* 記住帳號 + 忘記密碼（寄魔術連結） */}
            <div className="flex items-center justify-between text-sm">
              <label className="inline-flex items-center gap-2 select-none text-zinc-300">
                <input
                  type="checkbox"
                  className="accent-yellow-500"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                記住帳號
              </label>

              <button
                type="button"
                onClick={sendMagicLink}
                disabled={!email || loading}
                className="text-yellow-400 hover:underline disabled:opacity-40"
              >
                忘記密碼？
              </button>
            </div>

            {/* 訊息區 */}
            {msg && <p className="text-sm text-red-400">{msg}</p>}

            {/* 主要登入按鈕 */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg px-3 py-3 bg-yellow-500/90 hover:bg-yellow-500 text-black font-semibold disabled:opacity-50"
            >
              {loading ? '處理中…' : '登入'}
            </button>

            {/* 備用：魔術連結 */}
            <button
              type="button"
              onClick={sendMagicLink}
              disabled={!email || loading}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 py-3 text-sm hover:bg-zinc-700 disabled:opacity-50"
            >
              寄送魔術連結到 Email
            </button>

            {/* 快速登入（與註冊頁一致的分隔樣式） */}
            <div className="relative my-2 h-px bg-zinc-800">
              <span className="absolute inset-x-0 -top-3 mx-auto bg-zinc-900 px-2 text-xs text-zinc-500">
                快速登入
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className="rounded-lg bg-zinc-800 border border-zinc-700 py-3 text-sm hover:bg-zinc-700"
              >
                Google
              </button>
              <button
                type="button"
                className="rounded-lg bg-zinc-800 border border-zinc-700 py-3 text-sm hover:bg-zinc-700"
              >
                Telegram
              </button>
            </div>

            {/* 去註冊 */}
            <p className="text-sm text-zinc-400 text-center">
              還沒有帳號？{' '}
              <a className="text-yellow-400 hover:underline" href="/register">
                去註冊
              </a>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
