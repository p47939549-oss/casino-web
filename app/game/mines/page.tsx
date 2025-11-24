'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/app/components/Header';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

type Cell = {
  id: string;
  r: number;
  c: number;
  revealed: boolean;
  flagged: boolean;
  bomb: boolean;
};

type GameStatus = 'idle' | 'playing' | 'boom' | 'cashout';

type HistoryItem = {
  id: string;
  created_at: string;
  status: 'pending' | 'settled';
  result: 'boom' | 'cashout' | null;
  wager_micro: number;
  payout_micro: number;
  delta_micro: number;
};

const ROWS = 5;
const COLS = 5;
const N = ROWS * COLS;

function makeEmptyBoard(): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cells.push({ id: `${r}-${c}`, r, c, revealed: false, flagged: false, bomb: false });
    }
  }
  return cells;
}
const idx = (r: number, c: number) => r * COLS + c;

function applyRevealed(cells: Cell[], indices: number[]) {
  const next = [...cells];
  for (const i of indices) if (i >= 0 && i < next.length) next[i] = { ...next[i], revealed: true };
  return next;
}
function applyBombs(cells: Cell[], bombs: number[]) {
  const next = [...cells];
  for (const i of bombs) if (i >= 0 && i < next.length) next[i] = { ...next[i], bomb: true };
  return next;
}

function DiamondIcon() {
  return (
    <svg viewBox="0 0 64 64" className="w-7 h-7">
      <path d="M12 22L32 6l20 16-20 36L12 22z" fill="#7CFF7C" />
      <path d="M12 22h40L32 6 12 22z" fill="#B6FFB6" opacity=".6" />
      <path d="M32 6l10 16H22L32 6z" fill="#E3FFE3" opacity=".8" />
    </svg>
  );
}

type PickOK =
  | { ok: true; hit: false; revealed_indices: number[]; multiplier?: number; suggested_cashout_micro?: number }
  | { ok: true; hit: true; status: 'boom'; revealed_indices: number[]; bombs: number[] }
  | { ok: true; already: true; revealed_indices: number[]; multiplier?: number; suggested_cashout_micro?: number };

type CashoutOK = {
  ok: true;
  status: 'cashout';
  revealed_indices: number[];
  multiplier?: number;
  payout_micro: number;
  bombs: number[];
};

export default function Mines() {
  const [bombsCount, setBombsCount] = useState(5);
  const [wager, setWager] = useState<number>(1);
  const [status, setStatus] = useState<GameStatus>('idle');
  const [board, setBoard] = useState<Cell[]>(() => makeEmptyBoard());
  const [roundId, setRoundId] = useState<string | null>(null);

  const [revealedSafe, setRevealedSafe] = useState(0);
  const [serverMultiplier, setServerMultiplier] = useState<number | null>(null);
  const [serverSuggestedCashoutMicro, setServerSuggestedCashoutMicro] = useState<number | null>(null);

  const [isBusy, setIsBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);

  // === 載入動畫狀態 ===
  const [introVisible, setIntroVisible] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const totalSafe = N - bombsCount;

  async function loadHistory() {
    const { data, error } = await supabase
      .from('game_rounds_mines')
      .select('id,created_at,status,result,wager_micro,payout_micro,delta_micro')
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error && data) setHistory(data as any);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  // ★ 進入頁面時的「載入動畫」（約 1.8 秒）
  useEffect(() => {
    if (prefersReducedMotion) return;

    setIntroVisible(true);
    const t = setTimeout(() => setIntroVisible(false), 1800);

    return () => clearTimeout(t);
  }, [prefersReducedMotion]);

  function extractRoundId(data: any): string | null {
    if (!data) return null;
    if (typeof data === 'string') return data;
    if (data.round_id) return String(data.round_id);
    if (data.id) return String(data.id);
    if (data.uuid) return String(data.uuid);
    if (data.ok && data.round_id) return String(data.round_id);
    return null;
  }

  // ========== Start ==========
  const startGame = async () => {
    try {
      setIsBusy(true);
      setMsg('Starting…');

      const { data, error } = await supabase.rpc('mines_start', {
        p_bombs: bombsCount,
        p_wager_micro: Math.round((wager || 0) * 1_000_000),
        p_rows: ROWS,
        p_cols: COLS,
      });
      if (error) throw error;

      const rid = extractRoundId(data);
      if (!rid) {
        throw new Error('Round not created: unexpected return from mines_start');
      }

      setRoundId(rid);
      setBoard(makeEmptyBoard());
      setRevealedSafe(0);
      setServerMultiplier(null);
      setServerSuggestedCashoutMicro(null);
      setStatus('playing');
      setMsg(null);
      await loadHistory();
      // ✅ 開局時不再觸發動畫，動畫只在「進入頁面時」播
    } catch (e: any) {
      setMsg(e?.message ?? 'Failed to start round');
      setStatus('idle');
      setRoundId(null);
    } finally {
      setIsBusy(false);
    }
  };

  // ========== Pick ==========
  const reveal = async (r: number, c: number) => {
    if (status !== 'playing') {
      setMsg('Round is not active yet.');
      return;
    }
    if (!roundId) {
      setMsg('Round not ready. Please try Start again.');
      return;
    }

    const i = idx(r, c);
    const cell = board[i];
    if (cell.revealed || cell.flagged) return;

    try {
      setIsBusy(true);
      const { data, error } = await supabase.rpc('mines_pick', { p_round_id: roundId, p_index: i });
      if (error) throw error;

      const res = data as PickOK;

      if ('revealed_indices' in res) {
        let next = applyRevealed(board, res.revealed_indices);

        if ('hit' in res && res.hit === true) {
          next = applyBombs(next, (res as any).bombs ?? []);
          next = next.map((c) => ({ ...c, revealed: true }));
          setBoard(next);
          setStatus('boom');
          await loadHistory();
          return;
        }

        if ('multiplier' in res && typeof res.multiplier === 'number') {
          setServerMultiplier(res.multiplier);
        }
        if ('suggested_cashout_micro' in res && typeof res.suggested_cashout_micro === 'number') {
          setServerSuggestedCashoutMicro(res.suggested_cashout_micro);
        }

        const safeCount = next.filter((c) => c.revealed && !c.bomb).length;
        setRevealedSafe(safeCount);
        setBoard(next);
      }
    } catch (e: any) {
      setMsg(e?.message ?? 'Pick failed');
    } finally {
      setIsBusy(false);
    }
  };

  const toggleFlag = (r: number, c: number) => {
    if (status !== 'playing') return;
    const i = idx(r, c);
    const next = [...board];
    if (next[i].revealed) return;
    next[i] = { ...next[i], flagged: !next[i].flagged };
    setBoard(next);
  };

  // ========== Cashout ==========
  const cashout = async () => {
    if (status !== 'playing' || !roundId) return;
    try {
      setIsBusy(true);
      const { data, error } = await supabase.rpc('mines_cashout', { p_round_id: roundId });
      if (error) throw error;
      const res = data as CashoutOK;

      let next = applyRevealed(board, res.revealed_indices);
      next = applyBombs(next, res.bombs ?? []);
      next = next.map((c) => ({ ...c, revealed: true }));
      setBoard(next);

      if (typeof res.multiplier === 'number') setServerMultiplier(res.multiplier);

      setStatus('cashout');
      setMsg(`Cashout: ${(res.payout_micro / 1_000_000).toLocaleString()} tokens`);

      await loadHistory();
    } catch (e: any) {
      setMsg(e?.message ?? 'Cashout failed');
    } finally {
      setIsBusy(false);
    }
  };

  const uiCashout = useMemo(() => {
    if (serverSuggestedCashoutMicro != null) return serverSuggestedCashoutMicro / 1_000_000;
    if (serverMultiplier != null) return Number((wager * serverMultiplier).toFixed(6));
    const progress = totalSafe > 0 ? revealedSafe / totalSafe : 0;
    const est = wager * (1 + progress * (2.5 + bombsCount * 0.12));
    return Number(est.toFixed(6));
  }, [serverSuggestedCashoutMicro, serverMultiplier, wager, revealedSafe, totalSafe, bombsCount]);

  const uiMultiplier = useMemo(() => {
    if (serverMultiplier != null) return serverMultiplier;
    const denom = totalSafe > 0 ? totalSafe : 1;
    return Number((1 + (revealedSafe / denom) * (2.5 + bombsCount * 0.12)).toFixed(3));
  }, [serverMultiplier, revealedSafe, totalSafe, bombsCount]);

  // 只有在 playing 且沒有忙碌 & 沒在播「載入動畫」時才允許點棋盤
  const canInteract = status === 'playing' && !isBusy && !introVisible;

  return (
    <div>
      <Header />
      <div className="min-h-[calc(100vh-4rem)] w-full flex items-start justify-center p-6 bg-[#0e1525] text-slate-100">
        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-[340px_1fr] gap-6">
          {/* Left Panel */}
          <div className="bg-[#111a2e] rounded-2xl p-5 shadow-[0_10px_30px_rgba(0,0,0,.35)]">
            <div className="flex items-center gap-2 mb-3">
              <div className="px-3 py-1 rounded-full bg-[#0b1324] text-xs text-slate-300">Manual</div>
              <div className="px-3 py-1 rounded-full bg-[#0b1324] text-xs text-slate-500/70">Auto</div>
            </div>

            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-slate-400 mb-1">Bet Amount</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={wager}
                    onChange={(e) => setWager(Number(e.target.value))}
                    disabled={status === 'playing' || isBusy}
                    className="flex-1 bg-[#0b1324] rounded-xl px-3 py-2 outline-none"
                  />
                  <button
                    className="px-3 rounded-xl bg-[#0b1324]"
                    onClick={() => setWager((v) => Number((Math.max(0.01, v / 2)).toFixed(2)))}
                  >
                    ½
                  </button>
                  <button
                    className="px-3 rounded-xl bg-[#0b1324]"
                    onClick={() => setWager((v) => Number((v * 2).toFixed(2)))}
                  >
                    2×
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Mines</label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={bombsCount}
                    onChange={(e) => setBombsCount(Math.max(1, Math.min(24, Number(e.target.value))))}
                    disabled={status === 'playing' || isBusy}
                    className="w-full bg-[#0b1324] rounded-xl px-3 py-2 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Gems</label>
                  <div className="w-full bg-[#0b1324] rounded-xl px-3 py-2">
                    {ROWS * COLS - bombsCount}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-slate-400 text-sm">
                <span>Total profit</span>
                <span className="text-slate-200">{uiMultiplier.toFixed(2)}x</span>
              </div>

              <button
                onClick={startGame}
                disabled={isBusy || status === 'playing'}
                className="w-full mt-1 bg-[#1fe36b] hover:bg-[#2df47b] disabled:opacity-40 text-black font-semibold rounded-xl py-2"
              >
                Start New Game
              </button>

              <div className="mt-2 p-3 rounded-xl bg-[#0b1324] space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Revealed</span>
                  <span>
                    {revealedSafe}/{totalSafe}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Cashout value</span>
                  <span>{uiCashout.toLocaleString()}</span>
                </div>
                <button
                  onClick={cashout}
                  disabled={status !== 'playing' || revealedSafe === 0 || isBusy}
                  className="w-full mt-1 disabled:opacity-40 bg-[#1fe36b] hover:bg-[#2df47b] text-black font-semibold rounded-xl py-2"
                >
                  Cashout
                </button>
                {msg && <p className="text-xs mt-2 text-amber-300">{msg}</p>}
              </div>

              {/* History */}
              <div className="mt-3 rounded-xl bg-[#0b1324] p-3 h-64 overflow-y-auto">
                <div className="text-slate-300 text-sm mb-2">最近回合 & 總輸贏</div>
                <div className="space-y-2 text-xs">
                  {history.map((h) => {
                    const wager = h.wager_micro / 1_000_000;
                    const payout = h.payout_micro / 1_000_000;
                    const delta = h.delta_micro / 1_000_000;
                    const signCls =
                      delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-slate-400';
                    const resultText =
                      h.status === 'pending' ? 'pending' : h.result === 'boom' ? 'boom' : 'cashout';
                    return (
                      <div key={h.id} className="rounded-lg bg-[#0b1324] border border-white/5 p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">
                            {new Date(h.created_at).toLocaleString()}
                          </span>
                          <span className="text-slate-200">{resultText}</span>
                        </div>
                        <div className="mt-1 grid grid-cols-3 gap-2">
                          <div className="text-slate-400">
                            下注：<span className="text-slate-200">{wager}</span>
                          </div>
                          <div className="text-slate-400">
                            派彩：<span className="text-slate-200">{payout}</span>
                          </div>
                          <div className={signCls}>
                            淨變動：{delta > 0 ? '+' : ''}
                            {delta}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {history.length === 0 && <div className="text-slate-500">尚無紀錄</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Board + 頁面載入動畫 overlay */}
          <div className="bg-[#111a2e] rounded-2xl p-6 shadow-[0_10px_30px_rgba(0,0,0,.35)] relative overflow-hidden">
            {/* 載入動畫 */}
            <AnimatePresence>
              {introVisible && !prefersReducedMotion && (
                <motion.div
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {/* 籌碼 + 光暈 */}
                  <motion.div
                    className="relative flex items-center justify-center mb-4"
                    initial={{ scale: 0.5, y: -40 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 220, damping: 18, duration: 0.8 }}
                  >
                    {/* 外圈呼吸光暈 */}
                    <motion.div
                      className="absolute w-40 h-40 rounded-full bg-emerald-400/25 blur-xl"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: [0.8, 1.2, 0.9], opacity: [0, 1, 0.5] }}
                      transition={{ duration: 1.6, repeat: Infinity, repeatType: 'mirror' }}
                    />
                    {/* 籌碼本體 */}
                    <motion.div
                      className="relative w-20 h-20 rounded-full bg-[#16a34a] border-4 border-emerald-300 shadow-[0_0_40px_rgba(34,197,94,.9)] flex items-center justify-center"
                      initial={{ rotate: -120 }}
                      animate={{ rotate: 0 }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    >
                      <span className="text-lg font-bold text-black">Mines</span>
                    </motion.div>
                  </motion.div>

                  {/* Loading 文字 & 點點 */}
                  <div className="flex items-center gap-2 text-sm text-slate-100">
                    <span>Loading game</span>
                    <motion.span
                      className="flex gap-1"
                      initial={{ opacity: 0.3 }}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    >
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </motion.span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-5 gap-3 select-none relative z-10">
              {board.map((cell) => (
                <button
                  key={cell.id}
                  onClick={() => reveal(cell.r, cell.c)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleFlag(cell.r, cell.c);
                  }}
                  className={[
                    'aspect-square rounded-2xl flex items-center justify-center text-lg font-semibold transition-all',
                    'shadow-[inset_0_0_0_2px_rgba(255,255,255,.04)]',
                    cell.revealed ? 'bg-[#0f172a]' : 'bg-[#1b2742] hover:bg-[#223055]',
                    status === 'boom' && cell.bomb ? 'ring-2 ring-red-500' : '',
                  ].join(' ')}
                  disabled={!canInteract}
                >
                  {cell.revealed ? (cell.bomb ? <span className="text-2xl">💣</span> : <DiamondIcon />) : cell.flagged ? (
                    <span className="text-xl">🚩</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
