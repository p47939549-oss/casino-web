'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Header from '../../components/Header';

type Choice = 'high' | 'low';
type Phase = 'idle' | 'dealing' | 'flipping' | 'result';

const MICRO = 1_000_000;
const toToken = (micro?: number | null) => (micro ?? 0) / MICRO;
const toMicro = (token: number) => Math.max(1, Math.round((token || 0) * MICRO));

type GameSettings = {
  game: string;
  min_wager_micro: number;
  max_wager_micro: number | null;
  payout_multiplier: string;
};

// --------- 工具 ----------
const fmtToken = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 6 });

const fmtTokenMicro = (micro: number | null | undefined) =>
  ((micro ?? 0) / MICRO).toLocaleString(undefined, { maximumFractionDigits: 6 });

// A 最小的排序：1(A), 2..10, 11(J), 12(Q), 13(K)
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
const rankToLabel = (v: number) =>
  v === 1 ? 'A' : v <= 10 ? String(v) : v === 11 ? 'J' : v === 12 ? 'Q' : 'K';

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

type Suit = '♠' | '♣' | '♥' | '♦';
const SUITS: Suit[] = ['♠', '♣', '♥', '♦'];

type CardFace = { rank: number; suit: Suit; text: string };
const makeCard = (rank: number, suit?: Suit): CardFace => {
  const s = suit ?? SUITS[rand(0, SUITS.length - 1)];
  return { rank, suit: s, text: `${rankToLabel(rank)}${s}` };
};

// 依後端 winner 生成「有正確大小關係」的兩張牌（A 最小）
function makeConsistentPair(winner: 'blue' | 'red'): { blue: CardFace; red: CardFace } {
  // 讓畫面更直覺：高牌多半 9~K；低牌多半 A~8
  const hi = RANKS[rand(8, 12)]; // 9..K
  const lo = RANKS[rand(0, 7)];  // A..8
  if (winner === 'blue') {
    return { blue: makeCard(hi), red: makeCard(lo) };
  } else {
    return { blue: makeCard(lo), red: makeCard(hi) };
  }
}

// 判斷紅色花色（顯示紅色字）
const isRedSuit = (s: Suit) => s === '♥' || s === '♦';

// --------- 頁面 ----------
export default function HiLoGamePage() {
  const [loading, setLoading] = useState(true);
  // msg 僅保留錯誤訊息用
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [balanceMicro, setBalanceMicro] = useState<number>(0);

  // 遊戲控制
  const [choice, setChoice] = useState<Choice | null>(null);
  const [wagerTokenStr, setWagerTokenStr] = useState<string>('1');
  const [playing, setPlaying] = useState(false);

  // 動畫狀態
  const [phase, setPhase] = useState<Phase>('idle');
  const [blueFlipped, setBlueFlipped] = useState(false);
  const [redFlipped, setRedFlipped] = useState(false);
  const [winSide, setWinSide] = useState<'blue' | 'red' | null>(null);
  // 發牌入場：0=尚未入場, 1=已入場（控制滑入/淡入）
  const [dealStep, setDealStep] = useState<0 | 1>(0);
  // 牌桌中央結果徽章
  const [tableNotice, setTableNotice] = useState<null | { text: string; positive: boolean }>(null);

  const timeouts = useRef<number[]>([]);

  // 本局牌面（與後端結果一致）
  const [blueFace, setBlueFace] = useState<CardFace | null>(null);
  const [redFace, setRedFace] = useState<CardFace | null>(null);

  // 設定
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const minToken = useMemo(() => (settings ? toToken(settings.min_wager_micro) : 0.000001), [settings]);
  const balanceToken = useMemo(() => toToken(balanceMicro), [balanceMicro]);

  // 最近回合（從 DB）
  const [rounds, setRounds] = useState<any[]>([]);
  // 本次 session 的牌面快照（給彈窗）
  const [localFaces, setLocalFaces] = useState<Record<string, { blue: CardFace; red: CardFace }>>({});

  // 彈窗
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    return () => {
      timeouts.current.forEach((id) => clearTimeout(id));
      timeouts.current = [];
    };
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg('載入中…');

      const { data: ures } = await supabase.auth.getUser();
      if (!ures?.user) {
        setMsg('尚未登入');
        setLoading(false);
        return;
      }
      setUserId(ures.user.id);

      await refreshBalance(ures.user.id);
      await refreshSettings();
      await refreshRounds(ures.user.id);

      setMsg(null);
      setLoading(false);
    })();
  }, []);

  async function refreshBalance(uid: string) {
    const { data } = await supabase
      .from('balances')
      .select('amount_micro')
      .eq('user_id', uid)
      .maybeSingle();
    setBalanceMicro(data?.amount_micro ?? 0);
  }

  async function refreshSettings() {
    const { data } = await supabase
      .from('game_settings')
      .select('game,min_wager_micro,max_wager_micro,payout_multiplier')
      .eq('game', 'hilo')
      .maybeSingle();
    if (data) setSettings(data as GameSettings);
  }

  async function refreshRounds(uid: string) {
    const { data } = await supabase
      .from('game_rounds')
      .select('id, game, status, wager_micro, choice, result, payout_micro, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(10);
    setRounds(data ?? []);
  }

  const wagerTokenNum = useMemo(() => {
    const n = parseFloat(wagerTokenStr);
    return Number.isFinite(n) ? n : 0;
  }, [wagerTokenStr]);

  function validateWager(): string | null {
    const w = wagerTokenNum;
    const min = Math.max(0.000001, minToken);
    if (w < min) return `最小下注 ${min.toFixed(6)} Token`;
    if (w > balanceToken) return `不可超過可用餘額（${fmtToken(balanceToken)} Token）`;
    return null;
  }

  function quick(delta: number | 'half' | 'all') {
    if (delta === 'half') {
      setWagerTokenStr(Math.max(minToken, Math.floor(balanceToken / 2)).toString());
      return;
    }
    if (delta === 'all') {
      setWagerTokenStr(Math.max(minToken, Math.floor(balanceToken)).toString());
      return;
    }
    const cur = parseFloat(wagerTokenStr || '0') || 0;
    setWagerTokenStr((cur + delta).toString());
  }

  function resetTable() {
    timeouts.current.forEach((id) => clearTimeout(id));
    timeouts.current = [];
    setPhase('idle');
    setBlueFlipped(false);
    setRedFlipped(false);
    setWinSide(null);
    setBlueFace(null);
    setRedFace(null);
    setDealStep(0);
    setTableNotice(null);
  }

  async function playOnce() {
    if (!userId) return;
    if (!choice) { setMsg('請先選擇 High 或 Low。'); return; }
    const v = validateWager();
    if (v) { setMsg(v); return; }

    const wagerMicro = toMicro(wagerTokenNum);
    setPlaying(true);
    setMsg(null);              // 清空錯誤條
    resetTable();              // 清動畫

    try {
      const { data, error } = await supabase.rpc('play_hilo_round', {
        p_choice: choice,
        p_wager_micro: wagerMicro,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      const resultSide: 'high' | 'low' = row?.result_side ?? row?.result ?? row?.status_text ?? row?.status;

      // 即時更新餘額
      if (row?.balance_after_micro != null) {
        setBalanceMicro(row.balance_after_micro);
      } else {
        setBalanceMicro((b) => b + ((row?.payout_micro ?? 0) - (row?.wager_micro ?? wagerMicro)));
      }

      // 推到列表
      if (row) {
        setRounds((prev) => [
          {
            id: row.id,
            game: row.game,
            status: row.status ?? row.status_text ?? 'settled',
            wager_micro: row.wager_micro,
            choice: row.choice,
            result: row.result ?? row.result_side ?? resultSide,
            payout_micro: row.payout_micro,
            created_at: row.created_at,
          },
          ...prev,
        ].slice(0, 10));
      } else {
        await refreshRounds(userId);
      }

      // 生成與勝負一致的牌面（兩邊花色隨機、A 最小）
      const winner = resultSide === 'high' ? 'blue' : 'red';
      const pair = makeConsistentPair(winner);
      setBlueFace(pair.blue);
      setRedFace(pair.red);
      if (row?.id) {
        setLocalFaces((m) => ({ ...m, [row.id]: { blue: pair.blue, red: pair.red } }));
      }

      // === 動畫：發牌 -> 翻藍 -> 翻紅 -> 結果徽章 ===
      setPhase('dealing');
      setDealStep(0);
      timeouts.current.push(window.setTimeout(() => {
        setDealStep(1); // 滑入 & 淡入

        timeouts.current.push(window.setTimeout(() => {
          setPhase('flipping');
          setBlueFlipped(true);

          timeouts.current.push(window.setTimeout(() => {
            setRedFlipped(true);

            timeouts.current.push(window.setTimeout(() => {
              setPhase('result');
              setWinSide(winner);
              const net = ((row?.payout_micro ?? 0) - (row?.wager_micro ?? wagerMicro)) / MICRO;

              // 只用牌桌徽章提示，不再用上方黃色通知
              setTableNotice({
                text: `${net >= 0 ? '+' : ''}${net.toLocaleString(undefined, { maximumFractionDigits: 6 })} Token`,
                positive: net >= 0,
              });
              // 自動淡出
              timeouts.current.push(window.setTimeout(() => setTableNotice(null), 1800));
            }, 450)); // 第二張翻完後
          }, 450));   // 第一張翻完後
        }, 120));     // 入場完成後小延遲
      }, 20));        // 先讓 DOM 放上再做入場

    } catch (e: any) {
      const code = e?.code || 'rpc_error';
      const detail = e?.details || e?.message || String(e);
      setMsg(`${code}: ${detail}`); // 僅錯誤才顯示
      resetTable();
    } finally {
      timeouts.current.push(window.setTimeout(() => setPlaying(false), 400));
    }
  }

  // 卡片
  function Card({ color, flipped, face }: { color: 'blue' | 'red'; flipped: boolean; face: CardFace | null; }) {
    const backGrad =
      color === 'blue'
        ? 'from-blue-500/25 to-indigo-600/25 border-blue-400/40'
        : 'from-rose-500/25 to-pink-600/25 border-rose-400/40';

    const suit = face?.suit ?? '♣';
    const suitCls = isRedSuit(suit) ? 'text-rose-600' : 'text-zinc-900';
    const rankLabel = face ? rankToLabel(face.rank) : '';

    return (
      <div className="relative w-[10.5rem] h-[15rem] sm:w-[13rem] sm:h-[18rem] [perspective:1000px]">
        <div className="absolute inset-0 rounded-2xl border border-zinc-700/70 shadow-[0_8px_30px_rgba(0,0,0,0.35)] bg-zinc-950/70" />
        <div
          className="absolute inset-0 m-2 rounded-xl [transform-style:preserve-3d] transition-transform duration-500"
          style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
        >
          {/* 背面 */}
          <div className={`absolute inset-0 rounded-xl bg-gradient-to-br grid place-items-center border ${backGrad} [backface-visibility:hidden]`}>
            <div className="w-24 h-32 rounded-md border grid place-items-center bg-white/5 border-white/20 text-white/80 text-lg font-semibold">
              {color === 'blue' ? 'HI' : 'LO'}
            </div>
          </div>
          {/* 正面 */}
          <div className="absolute inset-0 rounded-xl grid place-items-center bg-zinc-100 text-zinc-900 [transform:rotateY(180deg)] [backface-visibility:hidden]">
            {face ? (
              <div className="select-none flex items-center gap-2 text-5xl sm:text-6xl font-semibold">
                <span>{rankLabel}</span>
                <span className={suitCls}>{suit}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

const canInteract = !playing;               // 只要沒有在進行動畫/下注就能選邊與改金額

  // 總輸贏（最近 10 局）
  const totalNetToken = useMemo(() => {
    return rounds.reduce((sum, r) => sum + ((r.payout_micro ?? 0) - (r.wager_micro ?? 0)) / MICRO, 0);
  }, [rounds]);

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col">
      <Header />

      {/* 主區塊滿版：上方資訊 + 中間牌桌 + 下方操作 */}
      <div className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">

        <h1 className="text-2xl font-semibold">Hi-Lo 比大小</h1>

        {/* 只有錯誤時才顯示 */}
        {msg && (
          <div className="rounded-lg border border-yellow-700 bg-yellow-950/30 text-yellow-400 p-3">
            {msg}
          </div>
        )}

        {/* 玩家資訊 */}
        <div className="rounded-xl border border-zinc-800 p-4 bg-zinc-900/40">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
            <div>
              <div className="text-sm text-zinc-400">目前帳號</div>
              <div className="font-mono break-all">{userId ?? '未登入'}</div>
            </div>
            <div>
              <div className="text-sm text-zinc-400">可用餘額</div>
              <div className="text-2xl font-bold">{fmtTokenMicro(balanceMicro)} Token</div>
            </div>
            <div className="text-xs text-zinc-500">
              {settings && <>限制：≥ {toToken(settings.min_wager_micro)} Token • 賠率 x{settings.payout_multiplier}</>}
            </div>
          </div>
        </div>

        {/* 牌桌（relative 以承載結果徽章） */}
        <div className="relative rounded-xl border border-zinc-800 p-5 bg-zinc-900/50 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-zinc-400">牌桌</div>
            <div className="text-xs text-zinc-500">兩邊花色皆隨機（♠♣♥♦），A 最小</div>
          </div>

          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-8 place-items-center">
            {/* 藍色方 */}
            <div className={`flex flex-col items-center gap-3 ${winSide === 'blue' && phase === 'result' ? 'ring-2 ring-blue-400 rounded-xl p-2' : ''}`}>
              <div className="text-sm font-medium text-blue-300">藍色方（High）</div>
              <div
                className={`transition-all duration-400 ${dealStep === 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              >
                <Card color="blue" flipped={blueFlipped} face={blueFace} />
              </div>
            </div>

            {/* 紅色方 */}
            <div className={`flex flex-col items-center gap-3 ${winSide === 'red' && phase === 'result' ? 'ring-2 ring-rose-400 rounded-xl p-2' : ''}`}>
              <div className="text-sm font-medium text-rose-300">紅色方（Low）</div>
              <div
                className={`transition-all duration-400 ${dealStep === 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              >
                <Card color="red" flipped={redFlipped} face={redFace} />
              </div>
            </div>
          </div>

          {/* 牌桌結果徽章 */}
          {tableNotice && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className={`px-4 py-2 rounded-full text-sm font-semibold shadow
                ${tableNotice.positive
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/40'}`}>
                {tableNotice.text}
              </div>
            </div>
          )}

          <div className="mt-4 text-xs text-zinc-500">狀態：{phase}</div>
        </div>

        {/* 操作區 */}
        <div className="rounded-xl border border-zinc-800 p-4 bg-zinc-900/40">
          <div className="text-sm text-zinc-400 mb-2">選擇你的下注方向與金額</div>
          <div className="flex flex-wrap gap-3 items-center">
            <button
              disabled={!canInteract}
              onClick={() => setChoice('high')}
              className={`rounded-lg px-4 py-2 border ${choice === 'high' ? 'bg-yellow-500 text-black border-yellow-500' : 'bg-zinc-800 border-zinc-700'} disabled:opacity-50`}
            >
              選擇 High
            </button>
            <button
              disabled={!canInteract}
              onClick={() => setChoice('low')}
              className={`rounded-lg px-4 py-2 border ${choice === 'low' ? 'bg-yellow-500 text-black border-yellow-500' : 'bg-zinc-800 border-zinc-700'} disabled:opacity-50`}
            >
              選擇 Low
            </button>

            <input
              type="number"
              step="0.000001"
              min={Math.max(0.000001, minToken)}
              value={wagerTokenStr}
              onChange={(e) => setWagerTokenStr(e.target.value)}
              className="rounded-lg px-3 py-2 bg-zinc-900/80 border border-zinc-700 w-[160px]"
              placeholder="下注金額（Token）"
              disabled={!canInteract}
            />

            <button onClick={() => quick(10)} className="px-3 py-2 border border-zinc-700 rounded-lg bg-zinc-800">+10</button>
            <button onClick={() => quick(50)} className="px-3 py-2 border border-zinc-700 rounded-lg bg-zinc-800">+50</button>
            <button onClick={() => quick(100)} className="px-3 py-2 border border-zinc-700 rounded-lg bg-zinc-800">+100</button>
            <button onClick={() => quick('half')} className="px-3 py-2 border border-zinc-700 rounded-lg bg-zinc-800">Half</button>
            <button onClick={() => quick('all')} className="px-3 py-2 border border-zinc-700 rounded-lg bg-zinc-800">All-in</button>

            <button
              onClick={playOnce}
              disabled={playing || !choice || !userId}
              className="rounded-lg px-4 py-2 bg-yellow-500 text-black disabled:opacity-50"
            >
              {playing ? '下注中…' : '開始遊戲'}
            </button>
          </div>

          <div className="text-xs text-zinc-500 mt-2">
            ※ 下注會呼叫 RPC：<code>play_hilo_round(p_choice, p_wager_micro)</code>；金額單位為 micro。
          </div>
        </div>
      </div>

      {/* 右下角 浮動「遊戲紀錄」按鈕 */}
      <button
        onClick={() => setShowHistory(true)}
        className="fixed bottom-4 right-4 rounded-full bg-zinc-900 border border-zinc-700 px-4 py-3 shadow-lg hover:bg-zinc-800"
      >
        遊戲紀錄
      </button>

      {/* 紀錄彈窗 */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 grid place-items-center p-4">
          <div className="w-full max-w-3xl rounded-xl bg-zinc-950 border border-zinc-700">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="text-lg font-semibold">最近回合 & 總輸贏</div>
              <button onClick={() => setShowHistory(false)} className="px-3 py-1 rounded-md bg-zinc-800 border border-zinc-700">
                關閉
              </button>
            </div>

            <div className="px-4 pt-3 pb-4 max-h-[70vh] overflow-auto">
              <div className="mb-3 text-sm">
                總輸贏：<span className={totalNetToken >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {totalNetToken >= 0 ? '+' : ''}{fmtToken(totalNetToken)} Token
                </span>
              </div>

              {rounds.length === 0 ? (
                <div className="text-zinc-500 text-sm">尚無紀錄</div>
              ) : (
                <div className="space-y-2">
                  {rounds.map((r) => {
                    const net = (r.payout_micro ?? 0) - (r.wager_micro ?? 0);
                    const netToken = net / MICRO;
                    const faceSnap = localFaces[r.id]; // 只有本 session 生成的會有
                    return (
                      <div key={r.id} className="border border-zinc-800 rounded-lg p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm text-zinc-400">
                            {new Date(r.created_at).toLocaleString()}
                          </div>
                          <div className={`text-sm font-mono ${netToken >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {netToken >= 0 ? '+' : ''}{fmtToken(netToken)} Token
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                          <div>選擇：<span className="font-mono">{r.choice}</span></div>
                          <div>結果：<span className="font-mono">{r.result ?? r.status}</span></div>
                          <div>下注：<span className="font-mono">{fmtTokenMicro(r.wager_micro)} Token</span></div>
                          <div>派彩：<span className="font-mono">{fmtTokenMicro(r.payout_micro)} Token</span></div>
                        </div>

                        <div className="mt-2 text-sm">
                          牌面：
                          {faceSnap ? (
                            <span className="font-mono">
                              藍 {rankToLabel(faceSnap.blue.rank)}
                              <span className={isRedSuit(faceSnap.blue.suit) ? 'text-rose-400' : ''}>{faceSnap.blue.suit}</span>
                              {'  '} / 紅 {rankToLabel(faceSnap.red.rank)}
                              <span className={isRedSuit(faceSnap.red.suit) ? 'text-rose-400' : ''}>{faceSnap.red.suit}</span>
                            </span>
                          ) : (
                            <span className="text-zinc-500">（本次登入前的回合沒有牌面快照）</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && <div className="fixed bottom-4 left-4 text-sm text-zinc-400">讀取中…</div>}
    </div>
  );
}
