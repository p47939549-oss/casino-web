// app/api/admin/pending-counts/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // 只在 server 用

const admin = createClient(url, serviceKey);

export async function GET() {
  try {
    // deposits
    const { count: depCnt, error: e1 } = await admin
      .from('deposits')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (e1) throw e1;

    // withdrawals / withdraws 你的表名如果是 withdraws，就這樣就好
    let witCnt = 0;
    let e2: any = null;

    const r1 = await admin
      .from('withdraws') // ← 若你的表叫 withdrawals，改成 withdrawals
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    witCnt = r1.count ?? 0;
    e2 = r1.error;

    if (e2) throw e2;

    return NextResponse.json({
      deposits: depCnt ?? 0,
      withdrawals: witCnt ?? 0,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'unknown error', deposits: 0, withdrawals: 0 },
      { status: 500 }
    );
  }
}
