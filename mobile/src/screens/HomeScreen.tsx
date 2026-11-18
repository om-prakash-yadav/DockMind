import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, ApiError, PurchaseOrder, Receipt } from '../api';
import { pickPhoto } from '../capture';
import { Banner, Button } from '../components/ui';
import { discard, drain, enqueue, onSynced, QueueItem, retry, useQueue } from '../offline/queue';
import { colors, statusStyle } from '../theme';

const CACHE_KEY = 'dockmind.cache.v1';

/** Last good lists, so the clerk still sees POs and receipts when the dock has no signal. */
async function saveCache(orders: PurchaseOrder[], receipts: Receipt[]) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ orders, receipts }));
  } catch {}
}
async function readCache(): Promise<{ orders: PurchaseOrder[]; receipts: Receipt[] } | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function HomeScreen({ onOpenReceipt }: { onOpenReceipt: (id: string) => void }) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const queue = useQueue();

  const load = useCallback(async () => {
    try {
      const [po, rc] = await Promise.all([api.openPurchaseOrders(), api.receipts()]);
      setOrders(po);
      setReceipts(rc);
      setError(null);
      setOffline(false);
      saveCache(po, rc);
    } catch (e) {
      if (e instanceof ApiError && e.isOffline) {
        const cached = await readCache();
        if (cached) {
          setOrders(cached.orders);
          setReceipts(cached.receipts);
        }
        setOffline(true);
        setError(null);
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not load.');
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // When a queued photo finishes uploading, its receipt should appear in the list.
  useEffect(() => onSynced(() => void load()), [load]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), drain().catch(() => {})]);
    setRefreshing(false);
  };

  /** Saves the photo to the queue first (works with no signal), then tries to upload right away. */
  const capture = async (source: 'camera' | 'gallery') => {
    try {
      const photo = await pickPhoto(source);
      if (!photo) return;
      setSaving(true);
      const item = await enqueue(photo);
      const synced = await drain();
      const receiptId = synced.get(item.localId);
      if (receiptId) onOpenReceipt(receiptId);
      else Alert.alert('Saved on this phone', 'There is no signal right now. The photo will upload by itself when the connection is back.');
    } catch (e: any) {
      Alert.alert('Could not save the photo', e?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Text style={styles.title}>Dock receiving</Text>
      {error && <Banner kind="bad" text={error} action={{ label: 'Try again', onPress: refresh }} />}
      {offline && <Banner text="No signal. You can still photograph notes; they upload when the connection returns." />}

      <View style={styles.actions}>
        <Button title="Photograph delivery note" onPress={() => capture('camera')} busy={saving} />
        <Button title="Choose from gallery" kind="ghost" onPress={() => capture('gallery')} disabled={saving} />
      </View>

      {queue.length > 0 && (
        <>
          <Text style={styles.section}>Waiting to sync ({queue.length})</Text>
          {queue.map((item) => (
            <QueueRow key={item.localId} item={item} />
          ))}
        </>
      )}

      <Text style={styles.section}>Receipts</Text>
      {receipts.length === 0 && !error && <Text style={styles.empty}>No receipts yet. Photograph a delivery note to start.</Text>}
      {receipts.map((r) => {
        const s = statusStyle[r.status];
        return (
          <TouchableOpacity key={r.id} style={styles.card} onPress={() => onOpenReceipt(r.id)}>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{r.supplier ?? 'Unknown supplier'}</Text>
              <Text style={[styles.status, { color: s.color }]}>{s.label}</Text>
            </View>
            <Text style={styles.muted}>
              {r.id} · {r.poNumber ?? 'PO not matched'}
              {r.needsReview && r.status === 'EXTRACTED' ? ' · check before confirming' : ''}
            </Text>
          </TouchableOpacity>
        );
      })}

      <Text style={styles.section}>Open purchase orders</Text>
      {orders.map((po) => (
        <View key={po.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{po.poNumber}</Text>
            <Text style={styles.muted}>{po.lines.length} lines</Text>
          </View>
          <Text style={styles.muted}>{po.supplier}</Text>
          {po.lines.map((l) => (
            <Text key={l.id} style={styles.lineText}>
              {l.description} · {l.orderedQty} {l.unit}
            </Text>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  const failed = item.state === 'failed';
  const label = failed ? 'Could not upload' : item.state === 'syncing' ? 'Uploading…' : 'Waiting to sync';
  const color = failed ? colors.bad : item.state === 'syncing' ? colors.primary : colors.warn;
  return (
    <View style={[styles.card, { borderColor: color, borderWidth: 2 }]}>
      <View style={styles.queueTop}>
        <Image source={{ uri: item.photoUri }} style={styles.thumb} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.cardTitle, { color }]}>{label}</Text>
          <Text style={styles.muted}>
            Photographed {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {item.attempts > 0 ? ` · tried ${item.attempts}×` : ''}
          </Text>
          {item.lastError && <Text style={styles.muted}>{item.lastError}</Text>}
        </View>
      </View>
      {failed && (
        <View style={styles.queueActions}>
          <View style={{ flex: 1 }}>
            <Button title="Try again" onPress={() => void retry(item.localId)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Delete photo"
              kind="danger"
              onPress={() =>
                Alert.alert('Delete this photo?', 'It has not been uploaded and cannot be recovered.', [
                  { text: 'Keep', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => void discard(item.localId) },
                ])
              }
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingTop: 56, gap: 10, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink },
  actions: { gap: 10, marginVertical: 6 },
  section: { fontSize: 18, fontWeight: '800', color: colors.ink, marginTop: 14 },
  empty: { color: colors.muted, fontSize: 15 },
  card: { backgroundColor: colors.card, borderRadius: 10, padding: 14, gap: 4, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  status: { fontSize: 14, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14 },
  lineText: { color: colors.ink, fontSize: 14, marginTop: 2 },
  queueTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: '#E1E4E8' },
  queueActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
});
