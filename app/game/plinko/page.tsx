'use client';

import { useEffect, useRef, useState } from 'react';
import Header from '@/app/components/Header';

type Risk = 'low' | 'medium' | 'high';

type Peg = { x: number; y: number; r: number };

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  trail: { x: number; y: number; alpha: number }[];
  alive: boolean;
  targetSlot?: number;
  settledSlot?: number;
};

/** 固定 17 槽倍率（左右對稱） */
const MULTIPLIERS: number[] = [
  100, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 100,
];

/** 把各倍率對應到所有槽位 index */
const SLOT_INDEXES_BY_MULT: Record<string, number[]> = (() => {
  const map: Record<string, number[]> = {};
  MULTIPLIERS.forEach((m, i) => {
    const k = String(m);
    if (!map[k]) map[k] = [];
    map[k].push(i);
  });
  return map;
})();

/** 依你要求的中獎機率（總和 100%）
 *  - 0.3/0.5/1  合計 85%（平均到它們所有槽）
 *  - 1.5/3      合計 12%（平均）
 *  - 5          合計 2%
 *  - 10         合計 0.6%
 *  - 41         合計 0.3%
 *  - 100        合計 0.1%
 */
function buildWeightsPerSlot(): number[] {
  const slots = MULTIPLIERS.length;
  const weights = new Array(slots).fill(0);

  // 低倍組 L
  const L_MULTS = ['0.3', '0.5', '1'];
  const L_idx = L_MULTS.flatMap((k) => SLOT_INDEXES_BY_MULT[k] ?? []);
  const L_share = 85 / Math.max(1, L_idx.length);
  L_idx.forEach((i) => (weights[i] = L_share));

  // 中倍組 M
  const M_MULTS = ['1.5', '3'];
  const M_idx = M_MULTS.flatMap((k) => SLOT_INDEXES_BY_MULT[k] ?? []);
  const M_share = 12 / Math.max(1, M_idx.length);
  M_idx.forEach((i) => (weights[i] = M_share));

  // 其餘獨立倍率
  const singleGroups: Record<string, number> = { '5': 2, '10': 0.6, '41': 0.3, '100': 0.1 };
  for (const k of Object.keys(singleGroups)) {
    const idxs = SLOT_INDEXES_BY_MULT[k] ?? [];
    const per = singleGroups[k] / Math.max(1, idxs.length);
    idxs.forEach((i) => (weights[i] = per));
  }

  // 微調到剛好 100
  const sum = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.001) {
    const fixAt = L_idx[0] ?? 0;
    weights[fixAt] += 100 - sum;
  }
  return weights;
}

function pickSlotByWeight(weights: number[]) {
  let tot = 0;
  for (const w of weights) tot += w;
  let r = Math.random() * tot;
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) return i;
    r -= weights[i];
  }
  return weights.length - 1;
}

export default function PlinkoPage() {
  // —— UI 狀態
  const [risk, setRisk] = useState<Risk>('medium');
  const [rows, setRows] = useState(12);
  const [amount, setAmount] = useState<number>(1);
  const [running, setRunning] = useState(false);

  const balance = 123.456; // TODO: 接 DB

  const weightsPerSlot = useRef<number[]>(buildWeightsPerSlot());

  // —— Canvas 參考
  const outerRef = useRef<HTMLDivElement | null>(null); // 外框（會有 aspect-square）
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const pegsRef = useRef<Peg[]>([]);
  const ballsRef = useRef<Ball[]>([]);
  // 讓棋盤是正方形：寬高會被 resize 設成一樣
  const boundsRef = useRef({ w: 700, h: 700, topPad: 70, bottomPad: 150 });

  // ====== Resize：把 Canvas 設成正方形，吃滿外框 ======
  useEffect(() => {
    function resize() {
      const outer = outerRef.current;
      const canvas = canvasRef.current;
      if (!outer || !canvas) return;

      const rect = outer.getBoundingClientRect();
      // 取外框寬高的較小者，確保正方形
      const size = Math.floor(Math.max(480, Math.min(rect.width, rect.height)));

      canvas.width = size;
      canvas.height = size;

      boundsRef.current = {
        w: size,
        h: size,
        topPad: Math.round(size * 0.1),     // 依尺寸調整 padding
        bottomPad: Math.round(size * 0.22),
      };

      buildPegs();
      renderOnce();
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (outerRef.current) ro.observe(outerRef.current);
    return () => ro.disconnect();
  }, [rows]);

  // ====== 釘子佈局（等腰三角）======
  function buildPegs() {
    const pegs: Peg[] = [];
    const { w, h, topPad, bottomPad } = boundsRef.current;

    const boardH = h - topPad - bottomPad;
    const spacingY = boardH / rows;
    const pegR = Math.max(2.4, Math.min(5, Math.floor(spacingY * 0.18)));
    const boardW = w * 0.82;            // 正方形中佔的寬
    const xCenter = w * 0.5;
    const stepX = boardW / rows;

    for (let r = 0; r < rows; r++) {
      const y = topPad + spacingY * r + spacingY * 0.3;
      const cols = r + 1;
      const rowW = (cols - 1) * stepX;
      const startX = xCenter - rowW * 0.5;
      for (let c = 0; c < cols; c++) {
        pegs.push({ x: startX + c * stepX, y, r: pegR });
      }
    }
    pegsRef.current = pegs;
  }

  // ====== 靜態繪製（背景、釘子、底部槽）======
  function renderOnce() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { w, h } = boundsRef.current;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1622';
    ctx.fillRect(0, 0, w, h);

    // pegs
    for (const p of pegsRef.current) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    drawMultipliers(ctx);
  }

  function drawMultipliers(ctx: CanvasRenderingContext2D) {
    const { w, h, bottomPad } = boundsRef.current;
    const slots = MULTIPLIERS.length;
    const pad = Math.round(w * 0.06);
    const usableW = w - pad * 2;
    const slotW = usableW / slots;
    const baseY = h - bottomPad + Math.round(w * 0.015);
    const barH = Math.round(w * 0.08);

    for (let i = 0; i < slots; i++) {
      const x = pad + i * slotW;
      ctx.fillStyle = '#151a23';
      ctx.strokeStyle = '#384254';
      roundRect(ctx, x + 2, baseY, slotW - 4, barH, Math.round(w * 0.012));
      ctx.stroke();

      ctx.fillStyle = '#dfe7f4';
      ctx.font = `${Math.round(w * 0.018)}px ui-sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${MULTIPLIERS[i]}x`, x + slotW / 2, baseY + barH / 2);
    }

    // 槽頂端落線
    ctx.strokeStyle = '#2a3342';
    ctx.lineWidth = 1;
    for (let i = 0; i <= slots; i++) {
      const x = pad + i * (usableW / slots);
      ctx.beginPath();
      ctx.moveTo(x, h - bottomPad - 6);
      ctx.lineTo(x, h - 10);
      ctx.stroke();
    }
  }

  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.stroke();
  }

  // ====== 工具：計算某槽中心 X ======
  function slotCenterX(slot: number) {
    const { w } = boundsRef.current;
    const slots = MULTIPLIERS.length;
    const pad = Math.round(w * 0.06);
    const usableW = w - pad * 2;
    const slotW = usableW / slots;
    return pad + slotW * slot + slotW / 2;
  }

  // ====== 產生球：從頂部稍微隨機 ======
  function spawnBall(targetSlot: number) {
    const { w, topPad } = boundsRef.current;
    const x = w / 2 + (Math.random() - 0.5) * (w * 0.04);
    ballsRef.current.push({
      x,
      y: topPad - 24,
      vx: 0,
      vy: 0.62,
      r: 6,
      color: '#fbbf24',
      trail: [],
      alive: true,
      targetSlot,
    });
  }

  function spawnBurst(n: number) {
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const slot = pickSlotByWeight(weightsPerSlot.current);
        spawnBall(slot);
      }, i * 80);
    }
  }

  // ====== 物理 ======
  const gravity = 0.18;
  const air = 0.995;
  const bounce = 0.75;
  const pegBounce = 0.95;

  useEffect(() => {
    cancel();
    loop();
    return cancel;
  }, []);

  function cancel() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function loop() {
    rafRef.current = requestAnimationFrame(loop);
    step();
    draw();
  }

  function step() {
    const balls = ballsRef.current;
    const pegs = pegsRef.current;
    const { w, h, topPad, bottomPad } = boundsRef.current;

    for (const b of balls) {
      if (!b.alive) continue;

      // 拖尾
      b.trail.unshift({ x: b.x, y: b.y, alpha: 0.9 });
      if (b.trail.length > 20) b.trail.pop();

      // 重力與空阻
      b.vy += gravity;
      b.vx *= air;
      b.vy *= air;

      // —— 全程柔和導向：係數由 0 緩慢增強到 ~0.08（看起來不會突兀）
      if (b.targetSlot != null) {
        const tx = slotCenterX(b.targetSlot);
        const progress = Math.max(0, Math.min(1, (b.y - topPad) / (h - topPad - bottomPad)));
        const steer = 0.005 + 0.08 * progress * progress; // 前期幾乎無感，越接近底部越明顯
        const dx = tx - b.x;
        b.vx += dx * steer * 0.02;   // 影響速度（更自然）
        b.x += dx * steer * 0.02;    // 同時微量影響位置，避免最後瞬間偏轉
      }

      // 與釘碰撞
      for (const p of pegs) {
        const dx = b.x - p.x, dy = b.y - p.y;
        const dist = Math.hypot(dx, dy);
        const minD = b.r + p.r;
        if (dist < minD) {
          const nx = dx / (dist || 1e-6);
          const ny = dy / (dist || 1e-6);
          const overlap = minD - dist + 0.2;
          b.x += nx * overlap;
          b.y += ny * overlap;
          const dot = b.vx * nx + b.vy * ny;
          b.vx -= 2 * dot * nx;
          b.vy -= 2 * dot * ny;
          b.vx += (Math.random() - 0.5) * 0.35;
          b.vy += (Math.random() - 0.5) * 0.12;
          b.vx *= pegBounce;
          b.vy *= pegBounce;
        }
      }

      // 移動
      b.x += b.vx;
      b.y += b.vy;

      // 牆
      if (b.x < 6) { b.x = 6; b.vx = -b.vx * bounce; }
      if (b.x > w - 6) { b.x = w - 6; b.vx = -b.vx * bounce; }

      // 到達底部：只設定 settle，不再強拉
      if (b.y > h - bottomPad + 8 && !b.settledSlot) {
        b.settledSlot = b.targetSlot ?? undefined;
      }

      // 停住並移除
      if (b.y > h - 22) {
        b.y = h - 22;
        b.vx *= 0.4;
        b.vy = 0;
        setTimeout(() => (b.alive = false), 550);
      }
    }
    for (let i = balls.length - 1; i >= 0; i--) {
      if (!balls[i].alive) balls.splice(i, 1);
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    renderOnce();

    for (const b of ballsRef.current) {
      // trail
      for (let i = b.trail.length - 1; i >= 0; i--) {
        const t = b.trail[i];
        ctx.beginPath();
        ctx.arc(t.x, t.y, Math.max(1, b.r * (i / b.trail.length) * 0.9), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(239,68,68,${t.alpha * 0.7})`;
        ctx.fill();
        t.alpha *= 0.92;
      }
      // ball
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.shadowColor = 'rgba(251,191,36,0.6)';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // ====== UI Actions ======
  function onPlay() {
    if (running) return;
    setRunning(true);
    const slot = pickSlotByWeight(weightsPerSlot.current);
    spawnBall(slot);
    setTimeout(() => setRunning(false), 350);
  }

  function onBurst10() {
    if (running) return;
    setRunning(true);
    spawnBurst(10);
    setTimeout(() => setRunning(false), 1200);
  }

  // ====== Layout ======
  return (
    <div className="min-h-screen bg-[#000B16] text-white flex flex-col">
      <Header />

      <div className="flex flex-1 py-6 px-4 justify-center gap-6">
        {/* 左側控制面板（深色） */}
        <div className="w-[270px] rounded-xl p-4 flex flex-col gap-4 bg-[#0d1b28] border border-[#1f3346]">
          <h1 className="text-xl font-semibold">Plinko</h1>

          <div className="rounded-lg p-3 bg-[#07121c] border border-[#2a3f55]">
            <div className="text-xs text-gray-400">Balance</div>
            <div className="text-lg font-semibold text-white">${balance.toFixed(6)}</div>
          </div>

          <button className="w-full rounded-lg py-2 border border-[#2a3f55] bg-[#0b1b2a] hover:bg-[#0f273d] text-sm">
            Game History
          </button>

          <div>
            <div className="text-sm text-gray-400 mb-1">Amount</div>
            <div className="flex gap-2">
              <input
                type="number"
                step="1"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
                className="w-full rounded-lg px-3 py-2 bg-[#07121c] border border-[#2a3f55] text-white"
              />
              <button
                onClick={() => setAmount(Math.max(1, Math.floor(amount / 2)))}
                className="px-3 py-2 rounded-lg border border-[#2a3f55] bg-[#0b1b2a] text-sm hover:bg-[#0f273d]"
              >
                ½
              </button>
              <button
                onClick={() => setAmount(amount * 2)}
                className="px-3 py-2 rounded-lg border border-[#2a3f55] bg-[#0b1b2a] text-sm hover:bg-[#0f273d]"
              >
                2×
              </button>
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-400 mb-1">Risk</div>
            <select
              value={risk}
              onChange={(e) => setRisk(e.target.value as Risk)}
              className="w-full rounded-lg px-3 py-2 bg-[#07121c] border border-[#2a3f55] text-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          <div>
            <div className="text-sm text-gray-400 mb-1">Rows</div>
            <select
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
              className="w-full rounded-lg px-3 py-2 bg-[#07121c] border border-[#2a3f55] text-white"
            >
              {[8, 10, 12, 14, 16, 18].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onPlay}
            disabled={running}
            className="w-full rounded-lg bg-[#00e676] text-black font-semibold py-2 disabled:opacity-60"
          >
            Play
          </button>

          <button
            onClick={onBurst10}
            disabled={running}
            className="w-full rounded-lg py-2 border border-[#2a3f55] bg-[#0b1b2a] hover:bg-[#0f273d]"
          >
            x10
          </button>
        </div>

        {/* 右側：遊戲區（正方形） */}
        <div className="flex-1 rounded-xl p-4 border border-red-500 bg-[#121621]">
          <div
            ref={outerRef}
            className="w-full max-w-[900px] mx-auto aspect-square flex justify-center items-center"
          >
            <canvas ref={canvasRef} className="block rounded-lg border border-[#0f2a3a]" />
          </div>
        </div>
      </div>
    </div>
  );
}
