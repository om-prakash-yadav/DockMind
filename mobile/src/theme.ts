import { Platform } from 'react-native';
import { Discrepancy, Receipt, ReceiptStatus } from './api';

export const colors = {
  bg: '#F2F4F8',
  card: '#FFFFFF',
  ink: '#101828',
  ink2: '#344054',
  muted: '#667085',
  line: '#E4E7EC',
  primary: '#1D4ED8',
  primarySoft: '#E8EEFF',
  good: '#15803D',
  goodSoft: '#E7F6EC',
  warn: '#B45309',
  warnSoft: '#FEF3E2',
  bad: '#C0262D',
  badSoft: '#FDECEC',
  purple: '#6D3FC0',
  purpleSoft: '#F0EAFB',
};

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };

export const shadow = Platform.select({
  ios: { shadowColor: '#101828', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  default: { elevation: 2 },
})!;

type IconName = 'checkmark-circle' | 'arrow-down-circle' | 'arrow-up-circle' | 'swap-horizontal' | 'help-circle' | 'close-circle';

/** One place that says how each discrepancy looks. `rank` orders lines so problems come first. */
export const discrepancyStyle: Record<Discrepancy, { color: string; soft: string; label: string; icon: IconName; rank: number }> = {
  UNKNOWN_ITEM: { color: colors.bad, soft: colors.badSoft, label: 'Not on order', icon: 'help-circle', rank: 0 },
  NOT_DELIVERED: { color: colors.bad, soft: colors.badSoft, label: 'Not delivered', icon: 'close-circle', rank: 1 },
  UNIT_MISMATCH: { color: colors.purple, soft: colors.purpleSoft, label: 'Wrong unit', icon: 'swap-horizontal', rank: 2 },
  SHORT: { color: colors.warn, soft: colors.warnSoft, label: 'Short', icon: 'arrow-down-circle', rank: 3 },
  OVER: { color: colors.primary, soft: colors.primarySoft, label: 'Over', icon: 'arrow-up-circle', rank: 4 },
  MATCH: { color: colors.good, soft: colors.goodSoft, label: 'Matches', icon: 'checkmark-circle', rank: 5 },
};

export const statusStyle: Record<ReceiptStatus, { color: string; soft: string; label: string }> = {
  CAPTURED: { color: colors.muted, soft: '#EEF0F4', label: 'Reading…' },
  EXTRACTED: { color: colors.primary, soft: colors.primarySoft, label: 'To check' },
  NEEDS_MANUAL: { color: colors.warn, soft: colors.warnSoft, label: 'Needs you' },
  CONFIRMED: { color: colors.good, soft: colors.goodSoft, label: 'Confirmed' },
  DISPUTED: { color: colors.bad, soft: colors.badSoft, label: 'Disputed' },
};

export const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);

/** Lines that are not a clean match, e.g. 2 for "salmon short, scallops not on order". */
export const issueCount = (r: Receipt) => r.lines.filter((l) => l.discrepancy !== 'MATCH').length;

export function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
