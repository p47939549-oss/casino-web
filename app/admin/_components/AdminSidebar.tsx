'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getPendingCounts } from './getPendingCounts';

export default function AdminSidebar({ activePath }: { activePath: string }) {
  // 這裡要包含 support
  const [counts, setCounts] = useState({
    deposits: 0,
    withdrawals: 0,
    support: 0,
  });

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const c = await getPendingCounts();
        if (mounted) setCounts(c);
      } catch {
        // 靜默失敗
      }
    };

    load();

    // 每 10 秒輪詢確保 Badge 更新
    const t = setInterval(load, 10_000);

    // 視窗重新顯示時更新
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);

    return () => {
      mounted = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const nav = [
    { name: '儀表板', href: '/admin', icon: '📊' },
    { name: '儲值審核', href: '/admin/deposits', icon: '💰', badge: counts.deposits },
    { name: '提領審核', href: '/admin/withdrawals', icon: '🏧', badge: counts.withdrawals },
    { name: '客服對話', href: '/admin/support', icon: '💬', badge: counts.support },
  ];

  return (
    <div className="p-3 space-y-1">
      {nav.map((item) => {
        const active = activePath.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between px-3 py-2 rounded-md text-sm transition
            ${active ? 'bg-zinc-800 text-amber-400' : 'text-zinc-300 hover:bg-zinc-800/70'}`}
          >
            <div className="flex items-center gap-2">
              <span>{item.icon}</span>
              {item.name}
            </div>

            {(item.badge ?? 0) > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-500 text-black text-xs font-semibold">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
