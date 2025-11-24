// app/admin/getPendingCounts.ts
import { supabase } from '@/lib/supabase';

export type Counts = { deposits: number; withdrawals: number; support: number };

export async function getPendingCounts(): Promise<Counts> {
  // ========== 1) 儲值：admin_pending_deposits（視圖） ==========
  let deposits = 0;
  {
    const { count, error } = await supabase
      .from('admin_pending_deposits')
      .select('*', { count: 'exact', head: true });

    if (error) {
      // 後備：退回舊表/欄位（deposit_requests.status = 'pending'）
      const { count: fb } = await supabase
        .from('deposit_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      deposits = fb ?? 0;
    } else {
      deposits = count ?? 0;
    }
  }

  // ========== 2) 提領：api_withdraw_requests（只算 pending） ==========
  let withdrawals = 0;

  // 依序嘗試不同欄位命名，避免欄位名不一致造成整個壞掉
  const tryWithdrawQuery = async (col: 'status' | 'request_status' | null) => {
    const base = supabase
      .from('api_withdraw_requests')
      .select('*', { count: 'exact', head: true });
    return col ? base.eq(col, 'pending') : base.is('reviewed_at', null);
  };

  let wres = await tryWithdrawQuery('status');
  if (wres.error) wres = await tryWithdrawQuery('request_status');
  if (wres.error) wres = await tryWithdrawQuery(null);

  if (!wres.error) {
    withdrawals = wres.count ?? 0;
  } else {
    // 最後保險：退回舊表
    const { count: fb } = await supabase
      .from('withdraw_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    withdrawals = fb ?? 0;
  }

  // ========== 3) 客服：support_sessions（未結束的會話） ==========
  // 優先以 status != 'closed' 計算；若失敗嘗試 in('status', ['open','waiting'])；
  // 再不行就 0（保守）
  let support = 0;
  {
    let sres = await supabase
      .from('support_sessions')
      .select('*', { count: 'exact', head: true })
      .neq('status', 'closed');

    if (sres.error) {
      sres = await supabase
        .from('support_sessions')
        .select('*', { count: 'exact', head: true })
        .in('status', ['open', 'waiting'] as any);
    }

    if (!sres.error) {
      support = sres.count ?? 0;
    } else {
      support = 0;
    }
  }

  return { deposits, withdrawals, support };
}
