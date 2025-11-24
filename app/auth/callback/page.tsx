'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState('正在處理登入…');

  useEffect(() => {
    // ⚠️ 在 client 端解析 URL，不使用 useSearchParams（避免 build error）
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (!code) {
      setMsg('缺少 code 參數。');
      return;
    }

    (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        setMsg(error.message);
      } else {
        router.replace('/me'); // 登入成功後導回 /me
      }
    })();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <p>{msg}</p>
    </div>
  );
}
