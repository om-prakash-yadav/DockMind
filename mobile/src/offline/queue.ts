import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Photo } from '../capture';

/**
 * Offline capture queue.
 *
 * Each photo is copied into the app's document directory (safe from OS cache cleanup) and recorded in AsyncStorage
 * together with its idempotency key BEFORE any upload is attempted. Every retry, in any app session, sends the same
 * key, and the server returns the same receipt for it, so a retry can never create a second receipt.
 *
 * Items upload one at a time, oldest first. Only a 2xx response removes an item.
 */

export type QueueState = 'pending' | 'syncing' | 'failed';

export interface QueueItem {
  localId: string;
  idempotencyKey: string;
  photoUri: string;
  filename: string;
  createdAt: number;
  state: QueueState;
  attempts: number;
  lastError: string | null;
}

const STORAGE_KEY = 'dockmind.queue.v1';
/** After this many failed attempts the item stops retrying by itself and waits for the clerk. */
const MAX_AUTO_ATTEMPTS = 5;

let items: QueueItem[] = [];
let loaded: Promise<void> | null = null;
let draining: Promise<Map<string, string>> | null = null;
const listeners = new Set<() => void>();
const syncedListeners = new Set<(receiptId: string) => void>();

const emit = () => listeners.forEach((l) => l());

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
  emit();
}

function load(): Promise<void> {
  loaded ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      items = raw ? (JSON.parse(raw) as QueueItem[]) : [];
    } catch {
      items = [];
    }
    // The app was killed mid-upload. The request may or may not have reached the server; resending with the same
    // key is safe either way.
    items = items.map((i) => (i.state === 'syncing' ? { ...i, state: 'pending' } : i));
    emit();
  })();
  return loaded;
}

function removePhoto(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

/** Copies the photo somewhere permanent. The picker/manipulator output lives in the cache and can vanish. */
function keepPhoto(photo: Photo): string {
  const dir = new Directory(Paths.document, 'queue');
  if (!dir.exists) dir.create();
  const dest = new File(dir, `${photo.idempotencyKey}.jpg`);
  if (dest.exists) dest.delete();
  new File(photo.uri).copy(dest);
  return dest.uri;
}

/** Saves the photo to the queue. Returns as soon as it is safely on disk, with no network involved. */
export async function enqueue(photo: Photo): Promise<QueueItem> {
  await load();
  const item: QueueItem = {
    localId: photo.idempotencyKey,
    idempotencyKey: photo.idempotencyKey,
    photoUri: keepPhoto(photo),
    filename: photo.filename,
    createdAt: Date.now(),
    state: 'pending',
    attempts: 0,
    lastError: null,
  };
  items = [...items, item];
  await persist();
  return item;
}

/**
 * Uploads waiting items, oldest first. Returns localId -> receiptId for the items that synced in this run.
 * If the network is down it stops at the first item and leaves everything pending. Calls overlap safely:
 * a second call waits for the running one and then runs again, so nothing is uploaded twice at once.
 */
export function drain(): Promise<Map<string, string>> {
  const run = async () => {
    await load();
    const synced = new Map<string, string>();
    for (const snapshot of [...items]) {
      const current = items.find((i) => i.localId === snapshot.localId);
      if (!current || current.state === 'failed') continue;
      update(current.localId, { state: 'syncing' });
      await persist();
      try {
        const receipt = await api.createReceipt(current.photoUri, current.filename, current.idempotencyKey);
        removePhoto(current.photoUri);
        items = items.filter((i) => i.localId !== current.localId);
        synced.set(current.localId, receipt.id);
        await persist();
        syncedListeners.forEach((l) => l(receipt.id));
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError('ERROR', 'Upload failed');
        if (err.isOffline) {
          // No signal: not the item's fault. Keep it pending, don't count an attempt, and stop trying the rest.
          update(current.localId, { state: 'pending', lastError: err.message });
          await persist();
          break;
        }
        const attempts = current.attempts + 1;
        // 4xx (except 429) means the server will never accept this photo as-is; stop and let the clerk decide.
        const hopeless = err.httpStatus >= 400 && err.httpStatus < 500 && err.httpStatus !== 429;
        update(current.localId, {
          state: hopeless || attempts >= MAX_AUTO_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          lastError: err.message,
        });
        await persist();
      }
    }
    return synced;
  };

  const previous = draining ?? Promise.resolve(new Map<string, string>());
  const next = previous.then(run, run);
  draining = next;
  next.finally(() => {
    if (draining === next) draining = null;
  });
  return next;
}

function update(localId: string, patch: Partial<QueueItem>) {
  items = items.map((i) => (i.localId === localId ? { ...i, ...patch } : i));
}

/** Puts a failed item back in line for another automatic try. */
export async function retry(localId: string) {
  await load();
  update(localId, { state: 'pending', attempts: 0, lastError: null });
  await persist();
  return drain();
}

/** Gives up on an item and deletes its photo. */
export async function discard(localId: string) {
  await load();
  const item = items.find((i) => i.localId === localId);
  if (item) removePhoto(item.photoUri);
  items = items.filter((i) => i.localId !== localId);
  await persist();
}

/** The current state of one queued item, or undefined once it has uploaded. */
export function peek(localId: string): QueueItem | undefined {
  return items.find((i) => i.localId === localId);
}

export function onSynced(listener: (receiptId: string) => void) {
  syncedListeners.add(listener);
  return () => void syncedListeners.delete(listener);
}

/** Live view of the queue for the UI. */
export function useQueue(): QueueItem[] {
  const [snapshot, setSnapshot] = useState<QueueItem[]>(items);
  useEffect(() => {
    const sync = () => setSnapshot([...items]);
    listeners.add(sync);
    load().then(sync);
    return () => void listeners.delete(sync);
  }, []);
  return snapshot;
}
