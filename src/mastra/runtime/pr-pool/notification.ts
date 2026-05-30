import { queueRuntimeNotification } from '../notification-dispatch';
import type { PRItem } from './pr-pool-store';
import type { ChannelTarget } from '../../../gateway/types';

export function buildPrPoolNotification(scanResult: { scanned: number; dispatched: number; skipped: number; failed: number }): string {
  return [`PR Pool 扫描完成`, `扫描: ${scanResult.scanned}`, `已派发: ${scanResult.dispatched}`, `跳过: ${scanResult.skipped}`, `失败: ${scanResult.failed}`].join('\n');
}

export function buildPrItemCompletedNotification(item: PRItem, summary: string): string {
  return [`PR ${item.id} 已完成`, `Title: ${item.title}`, summary].join('\n');
}

export function buildPrItemFailedNotification(item: PRItem): string {
  return [`PR ${item.id} 开发失败`, `Title: ${item.title}`, item.blocking?.reason ? `Reason: ${item.blocking.reason}` : undefined].filter((line): line is string => Boolean(line)).join('\n');
}

export function buildPrItemBlockedNotification(item: PRItem): string {
  return [`PR ${item.id} 等待确认`, `Title: ${item.title}`, item.blocking?.reason ? `Reason: ${item.blocking.reason}` : '需要用户确认后继续。'].join('\n');
}

export async function sendPrPoolNotification(content: string, target?: ChannelTarget): Promise<void> {
  await queueRuntimeNotification({
    event: 'pr_pool.notification',
    target,
    text: content,
    sourceAgentId: 'pr-pool-runtime',
  });
}
