'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Header from './components/Header'; // ← 新增這行

export default function HomePage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? null);
    })();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Header /> {/* ← 用這行取代整段 <header>…</header> */}

      {/* Banner（佔位，之後可換輪播圖） */}
      <section className="border-b border-zinc-800 bg-gradient-to-b from-zinc-900 to-black">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h1 className="text-3xl md:text-4xl font-bold">深色 × 金色科技感 遊戲平台</h1>
          <p className="mt-2 text-zinc-300">
            用 Token 遊玩多款 HTML5 小遊戲，支援可驗證公平（Provably Fair）。
          </p>

          <div className="mt-6 flex gap-3">
            {email ? (
              <>
                <Link
                  href="/games"
                  className="rounded-xl px-4 py-2 bg-yellow-500/90 hover:bg-yellow-500 text-black font-semibold"
                >
                  開始遊戲
                </Link>
                <Link
                  href="/me"
                  className="rounded-xl px-4 py-2 border border-zinc-700 hover:bg-zinc-900"
                >
                  個人中心
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/register"
                  className="rounded-xl px-4 py-2 bg-yellow-500/90 hover:bg-yellow-500 text-black font-semibold"
                >
                  立即註冊
                </Link>
                <Link
                  href="/login"
                  className="rounded-xl px-4 py-2 border border-zinc-700 hover:bg-zinc-900"
                >
                  我已有帳號
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* 熱門遊戲（暫時佔位卡片） */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="text-xl font-semibold">熱門遊戲</h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { name: 'Dice / Hi-Lo', href: '/game/hilo' },
            { name: 'Mines', href: '/game/mines' },
            { name: 'Crash', href: '/game/crash' },
          ].map((g) => (
            <Link
              key={g.name}
              href={g.href}
              className="rounded-2xl border border-zinc-800 p-4 hover:border-yellow-500/60"
            >
              <div className="h-28 rounded-xl bg-zinc-900 mb-3" />
              <div className="font-medium">{g.name}</div>
              <div className="text-sm text-zinc-400">立即開始 →</div>
            </Link>
          ))}
        </div>
      </section>

      {/* 公告 / 新手引導（佔位） */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-zinc-800 p-4">
            <div className="font-semibold">活動公告</div>
            <ul className="mt-2 text-sm text-zinc-300 list-disc list-inside space-y-1">
              <li>首儲加贈 5%（示意）</li>
              <li>每日登入獎勵（示意）</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 p-4">
            <div className="font-semibold">新手引導</div>
            <ol className="mt-2 text-sm text-zinc-300 list-decimal list-inside space-y-1">
              <li>註冊 / 登入帳號</li>
              <li>到「個人中心」送出儲值申請</li>
              <li>管理員審核後即可開始遊戲</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
