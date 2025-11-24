'use client';

import Link from 'next/link';

export default function AdminTopbar() {
  return (
    // fixed 讓它永遠在頂部；z-50 確保蓋在內容上；h-14 = 56px
    <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-zinc-800 bg-zinc-950/85 backdrop-blur">
      <div className="mx-auto w-full max-w-[1400px] px-4 h-full flex items-center justify-between">
        <div className="text-lg font-semibold">管理後台</div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-amber-400 hover:underline">回前台</Link>
        </nav>
      </div>
    </header>
  );
}
