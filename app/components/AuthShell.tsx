// components/AuthShell.tsx
'use client';

import React from 'react';

type Props = {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export default function AuthShell({ title, children, footer }: Props) {
  return (
    <div className="min-h-screen bg-[#0B0B0C] text-white flex items-center justify-center">
      {/* 卡片：統一寬度/圓角/邊框/陰影/內距 */}
      <div className="w-[92%] max-w-[560px] rounded-2xl border border-zinc-800/80 bg-[#141415] shadow-[0_8px_40px_rgba(0,0,0,0.45)]">
        <div className="px-6 sm:px-8 pt-8 pb-6 border-b border-zinc-800/60">
          <h1 className="text-center text-xl sm:text-2xl font-semibold tracking-wide">
            {title}
          </h1>
        </div>

        <div className="px-6 sm:px-8 py-6">
          {children}
        </div>

        {footer ? (
          <div className="px-6 sm:px-8 pt-3 pb-6 border-t border-zinc-800/60 text-center text-sm text-zinc-400">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
