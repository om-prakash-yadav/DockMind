import { Discrepancy, ReceiptStatus } from './api';

export const colors = {
  bg: '#F4F5F7',
  card: '#FFFFFF',
  ink: '#14171A',
  muted: '#5C6670',
  line: '#DADFE5',
  primary: '#1B5FD6',
  good: '#1E7A3C',
  warn: '#B26A00',
  bad: '#C0262D',
  purple: '#6B3FA0',
};

/** Colour and short label for each discrepancy. The chip also shows the quantity difference. */
export const discrepancyStyle: Record<Discrepancy, { color: string; label: string }> = {
  MATCH: { color: colors.good, label: 'Matches' },
  SHORT: { color: colors.warn, label: 'Short' },
  OVER: { color: colors.primary, label: 'Over' },
  UNIT_MISMATCH: { color: colors.purple, label: 'Wrong unit' },
  UNKNOWN_ITEM: { color: colors.bad, label: 'Not on PO' },
  NOT_DELIVERED: { color: colors.bad, label: 'Not delivered' },
};

export const statusStyle: Record<ReceiptStatus, { color: string; label: string }> = {
  CAPTURED: { color: colors.muted, label: 'Reading…' },
  EXTRACTED: { color: colors.primary, label: 'Ready to check' },
  NEEDS_MANUAL: { color: colors.warn, label: 'Needs your input' },
  CONFIRMED: { color: colors.good, label: 'Confirmed' },
  DISPUTED: { color: colors.bad, label: 'Disputed' },
};

export const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
