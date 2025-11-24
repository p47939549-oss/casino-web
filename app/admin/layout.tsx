'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import AdminSidebar from './_components/AdminSidebar';
import AdminTopbar from './_components/AdminTopbar';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    // 讓整頁不捲動，由內容區負責捲動
    <div className="min-h-screen bg-black text-zinc-100 overflow-hidden">
      {/* 🔸 固定在最上方 */}
      <AdminTopbar />

      {/* 🔸 主容器：扣掉 header 高度 56px (h-14) 後，讓左右區域各自捲動 */}
      <div className="pt-14 h-[calc(100vh-56px)] w-full flex">
        {/* ✅ 左側側邊欄：黏在上方、自己可捲動 */}
        <aside className="w-[240px] border-r border-zinc-800 bg-zinc-950/80 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto">
          <AdminSidebar activePath={pathname} />
        </aside>

        {/* ✅ 右側內容：只讓這裡捲動 */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
