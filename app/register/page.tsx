'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function Eye({ on, ...p }: any) {
  return (
    <span {...p} className="cursor-pointer text-zinc-400 hover:text-white">
      {on ? '🙈' : '👁️'}
    </span>
  );
}

function TermsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[92%] max-w-xl rounded-2xl border border-zinc-700 bg-zinc-900">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="font-semibold">服務條款</div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-3 text-sm leading-6 text-zinc-200">
          <p>最後更新：2025-09-15</p>
          <p>以下為示意條款，請替換為你的正式內容。</p>
          <p>使用本服務即表示你同意遵守本條款與相關政策……</p>
          {/* 你可以在這裡放長條款 */}
        </div>
        <div className="p-3 border-t border-zinc-800 text-right">
          <button
            onClick={onClose}
            className="rounded-lg bg-yellow-500/90 hover:bg-yellow-500 text-black px-4 py-2 font-semibold"
          >
            我已閱讀
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();

  // 新增欄位
  const [username, setUsername] = useState('');          // 帳號 / 顯示名稱
  const [email, setEmail] = useState('');                // 電子信箱
  const [password, setPassword] = useState('');          // 密碼
  const [password2, setPassword2] = useState('');        // 再次確認密碼
  const [invite, setInvite] = useState('');              // 邀請碼（選填）
  const [captcha, setCaptcha] = useState('');            // 驗證碼（UI占位）

  // UI 狀態
  const [showPwd, setShowPwd] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [openTerms, setOpenTerms] = useState(false);

  const emailInvalid = useMemo(
    () => !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    [email]
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setOk(null);

    if (!username.trim()) return setMsg('請填寫帳號');
    if (!email.trim() || emailInvalid) return setMsg('請填寫正確的電子信箱格式');
    if (!password || password.length < 6) return setMsg('密碼至少 6 碼');
    if (password !== password2) return setMsg('兩次密碼不一致');
    if (!agree) return setMsg('請勾選同意服務條款');

    setLoading(true);
    try {
      // 1) 建立 Supabase 帳號
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) throw error;

      // 2) upsert profiles（假設表有 user_id, display_name, username, invite_code）
      const userId = data.user?.id;
      if (userId) {
        await supabase
          .from('profiles')
          .upsert(
            {
              user_id: userId,
              display_name: username,
              username: username,
              invite_code: invite || null,
            },
            { onConflict: 'user_id' }
          );
      }

      // 3) 給使用者回饋
      if (data?.user?.identities?.length === 0) {
        setOk('註冊成功，請到信箱確認後再登入。');
      } else {
        router.push('/me');
      }
    } catch (err: any) {
      setMsg(err?.message ?? '註冊失敗');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <TermsModal open={openTerms} onClose={() => setOpenTerms(false)} />

      <div className="min-h-screen bg-[url('/auth-bg.jpg')] bg-cover bg-center flex">
        {/* 左側 Banner（可放品牌圖/宣傳） */}
        <div className="hidden md:flex w-[38%] items-end justify-center bg-black/50">
          {/* 需要的話在這裡塞你的品牌區塊或圖片 */}
        </div>

        {/* 右側卡片表單 */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="px-6 pt-6 text-center">
              <div className="text-lg text-yellow-400 font-semibold">立即註冊</div>
            </div>

            <form onSubmit={onSubmit} className="p-6 space-y-4">
              {/* 帳號 */}
              <div>
                <label className="block text-sm mb-1 text-zinc-300">* 帳號</label>
                <input
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-3 text-sm outline-none focus:border-yellow-500"
                  placeholder="請輸入帳號"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              {/* 密碼 + 確認密碼 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm mb-1 text-zinc-300">* 密碼</label>
                  <div className="relative flex items-center gap-2">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-3 text-sm outline-none focus:border-yellow-500"
                      placeholder="請輸入密碼（至少 6 碼）"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <Eye on={showPwd} onClick={() => setShowPwd((v) => !v)} />
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-1 text-zinc-300">* 確認密碼</label>
                  <div className="relative flex items-center gap-2">
                    <input
                      type={showPwd2 ? 'text' : 'password'}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-3 text-sm outline-none focus:border-yellow-500"
                      placeholder="請再次輸入密碼"
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                    />
                    <Eye on={showPwd2} onClick={() => setShowPwd2((v) => !v)} />
                  </div>
                </div>
              </div>

              {/* 電子信箱 */}
              <div>
                <label className="block text-sm mb-1 text-zinc-300">* 電子信箱</label>
                <input
                  className={`w-full rounded-lg bg-zinc-800 border px-3 py-3 text-sm outline-none focus:border-yellow-500 ${
                    emailInvalid ? 'border-red-500' : 'border-zinc-700'
                  }`}
                  placeholder="name@example.com"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {emailInvalid && (
                  <div className="text-xs text-red-500 mt-1">請輸入正確的電子信箱格式</div>
                )}
              </div>

              {/* 邀請碼（選填） */}
              <div>
                <label className="block text-sm mb-1 text-zinc-300">邀請碼（選填）</label>
                <input
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-3 text-sm outline-none focus:border-yellow-500"
                  placeholder="若有邀請碼請填入"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                />
              </div>

              {/* 驗證碼（UI 占位） */}
              <div>
                <label className="block text-sm mb-1 text-zinc-300">* 驗證碼</label>
                <div className="flex items-center gap-3">
                  <input
                    className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-3 text-sm outline-none focus:border-yellow-500"
                    placeholder="請輸入驗證碼"
                    value={captcha}
                    onChange={(e) => setCaptcha(e.target.value)}
                  />
                  <div className="w-24 h-10 rounded-lg bg-zinc-800 border border-zinc-700 grid place-items-center text-sm">
                    3 1 2 7
                  </div>
                  <button type="button" className="text-xs text-zinc-300 hover:text-white">
                    重新產生
                  </button>
                </div>
              </div>

              {/* 條款勾選 */}
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="accent-yellow-500"
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                />
                我已年滿18歲並同意按注相關規範以及
                <button
                  type="button"
                  onClick={() => setOpenTerms(true)}
                  className="text-yellow-400 hover:underline"
                >
                  服務條款
                </button>
              </label>

              {/* 訊息區 */}
              {msg && <p className="text-sm text-red-400">{msg}</p>}
              {ok && <p className="text-sm text-emerald-400">{ok}</p>}

              {/* 送出 */}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg px-3 py-3 bg-yellow-500/90 hover:bg-yellow-500 text-black font-semibold disabled:opacity-50"
              >
                {loading ? '處理中…' : '確認註冊'}
              </button>

              {/* 快速註冊（占位） */}
              <div className="relative my-2 h-px bg-zinc-800">
                <span className="absolute inset-x-0 -top-3 mx-auto bg-zinc-900 px-2 text-xs text-zinc-500">
                  快速註冊
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

              <p className="text-sm text-zinc-400 text-center">
                已有帳號？{' '}
                <a className="text-yellow-400 hover:underline" href="/login">
                  去登入
                </a>
              </p>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
