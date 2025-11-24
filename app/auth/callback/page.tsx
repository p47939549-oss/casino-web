'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [msg, setMsg] = useState('正在處理登入…');

  useEffect(() => {
    const code = search.get('code');
    if (!code) {
      setMsg('缺少 code 參數。');
      return;
    }
    (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setMsg(error.message);
      } else {
        router.replace('/me');
      }
    })();
  }, [router, search]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <p>{msg}</p>
    </div>
  );
}
