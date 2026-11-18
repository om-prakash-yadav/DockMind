import { File } from 'expo-file-system';
import { API_URL } from './config';

export type Discrepancy = 'MATCH' | 'SHORT' | 'OVER' | 'UNIT_MISMATCH' | 'UNKNOWN_ITEM' | 'NOT_DELIVERED';
export type ReceiptStatus = 'CAPTURED' | 'EXTRACTED' | 'NEEDS_MANUAL' | 'CONFIRMED' | 'DISPUTED';

export interface ReceiptLine {
  id: string;
  poLineId: string | null;
  description: string;
  /** The quantity on the order, as originally ordered. */
  orderedQty: number | null;
  /** Already brought in by earlier confirmed deliveries. */
  previouslyReceivedQty: number | null;
  /** What this delivery is compared against: ordered minus previously received. */
  remainingQty: number | null;
  receivedQty: number;
  unit: string | null;
  confidence: number | null;
  discrepancy: Discrepancy;
  delta: number | null;
  needsReview: boolean;
  corrected: boolean;
  missingFromNote: boolean;
}

export interface Receipt {
  id: string;
  status: ReceiptStatus;
  poNumber: string | null;
  poNumberRead: string | null;
  supplier: string | null;
  deliveryNoteNo: string | null;
  overallConfidence: number | null;
  poConfidence: number | null;
  aiNote: string | null;
  freeText: string | null;
  needsReview: boolean;
  disputeReason: string | null;
  createdAt: string;
  lines: ReceiptLine[];
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplier: string;
  status: string;
  lines: { id: string; description: string; orderedQty: number; receivedQty: number; remainingQty: number; unit: string }[];
}

/** `code` is the server's error code, or NETWORK / TIMEOUT when the server could not be reached. */
export class ApiError extends Error {
  constructor(public code: string, message: string, public httpStatus = 0) {
    super(message);
  }
  /** True when the request never got an answer, so retrying later is sensible. */
  get isOffline() {
    return this.code === 'NETWORK' || this.code === 'TIMEOUT';
  }
}

/** Quick check that the server answers at all, to tell "no connection" apart from "this one request failed". */
async function serverReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(API_URL + '/purchase-orders?status=NONE', { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(API_URL + path, { ...init, signal: controller.signal });
  } catch (e: any) {
    clearTimeout(timer);
    const detail = String(e?.message ?? e);
    // If the server still answers, the connection is fine and this particular request is what failed. Say so
    // instead of claiming there is no signal.
    if (await serverReachable()) {
      throw new ApiError('REQUEST_FAILED', `The request could not be sent (${detail}).`);
    }
    if (e?.name === 'AbortError') throw new ApiError('TIMEOUT', 'The server is taking too long. Check the signal and try again.');
    throw new ApiError('NETWORK', `Cannot reach the server (${detail}). Check the signal and try again.`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let code = 'ERROR';
    let message = `Something went wrong (${res.status})`;
    try {
      const body = await res.json();
      code = body.error ?? code;
      message = body.message ?? message;
    } catch {}
    throw new ApiError(code, message, res.status);
  }
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  openPurchaseOrders: () => request<PurchaseOrder[]>('/purchase-orders?status=OPEN'),
  receipts: () => request<Receipt[]>('/receipts'),
  receipt: (id: string) => request<Receipt>(`/receipts/${id}`),
  imageUrl: (id: string) => `${API_URL}/receipts/${id}/image`,

  /** Same idempotencyKey always returns the same receipt, so this is safe to retry. */
  async createReceipt(photoUri: string, filename: string, idempotencyKey: string) {
    // Sent as raw bytes, not a multipart form: this Expo SDK's fetch cannot build a file part from a file path.
    const bytes = await new File(photoUri).bytes();
    return request<Receipt>(
      '/receipts',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey, 'Content-Type': 'image/jpeg', 'X-Filename': encodeURIComponent(filename) },
        body: bytes as any,
      },
      60000,
    );
  },

  correctLine: (receiptId: string, lineId: string, receivedQty: number) =>
    request<Receipt>(`/receipts/${receiptId}/lines/${lineId}`, json('PATCH', { receivedQty })),
  assignPo: (receiptId: string, poNumber: string) => request<Receipt>(`/receipts/${receiptId}`, json('PATCH', { poNumber })),
  confirm: (receiptId: string, acknowledged: boolean) =>
    request<Receipt>(`/receipts/${receiptId}/confirm`, json('POST', { acknowledged })),
  dispute: (receiptId: string, reason: string) => request<Receipt>(`/receipts/${receiptId}/dispute`, json('POST', { reason })),
};
