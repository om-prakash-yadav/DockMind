import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, PurchaseOrder, Receipt } from '../api';
import { pickPhoto } from '../capture';
import { Banner, Button, buzz, EmptyState, Pill, Skeleton, tap } from '../components/ui';
import { discard, drain, enqueue, onSynced, QueueItem, retry, useQueue } from '../offline/queue';
import { colors, issueCount, radius, shadow, statusStyle, timeAgo } from '../theme';

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

type Tab = 'receipts' | 'orders';
type Filter = 'all' | 'check' | 'done';

export default function HomeScreen({ onOpenReceipt }: { onOpenReceipt: (id: string) => void }) {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('receipts');
  const [filter, setFilter] = useState<Filter>('all');
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
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // When a queued photo finishes uploading, its receipt should appear in the list.
  useEffect(() => onSynced(() => void load()), [load]);

  // Reload as soon as the phone says it is back online, so the "No signal" banner clears itself.
  useEffect(() => NetInfo.addEventListener((s) => s.isConnected && void load()), [load]);

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
      if (receiptId) {
        buzz('success');
        onOpenReceipt(receiptId);
      } else {
        buzz('warning');
        Alert.alert('Saved on this phone', 'There is no signal right now. The photo will upload by itself when the connection is back.');
      }
    } catch (e: any) {
      Alert.alert('Could not save the photo', e?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const toCheck = receipts.filter((r) => r.status === 'EXTRACTED' || r.status === 'NEEDS_MANUAL' || r.status === 'CAPTURED').length;
  const shown = useMemo(
    () =>
      receipts.filter((r) =>
        filter === 'all' ? true : filter === 'done' ? r.status === 'CONFIRMED' || r.status === 'DISPUTED' : !(r.status === 'CONFIRMED' || r.status === 'DISPUTED'),
      ),
    [receipts, filter],
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>DockMind</Text>
          <Text style={styles.subtitle}>Harbor Foods · Receiving dock</Text>
        </View>
        <View style={[styles.conn, { backgroundColor: offline ? colors.warnSoft : colors.goodSoft }]}>
          <View style={[styles.dot, { backgroundColor: offline ? colors.warn : colors.good }]} />
          <Text style={[styles.connText, { color: offline ? colors.warn : colors.good }]}>{offline ? 'No signal' : 'Online'}</Text>
        </View>
      </View>

      {error && <Banner kind="bad" text={error} action={{ label: 'Try again', onPress: refresh }} />}
      {offline && <Banner text="No signal. You can still photograph notes. They upload when the connection returns." icon="cloud-offline" />}

      <View style={[styles.hero, shadow]}>
        <Text style={styles.heroTitle}>Truck at the dock?</Text>
        <Text style={styles.heroText}>Photograph the delivery note. We read it and compare it with the order.</Text>
        <Button title="Photograph delivery note" icon="camera" onPress={() => capture('camera')} busy={saving} />
        <Pressable onPress={() => capture('gallery')} disabled={saving} hitSlop={10} style={styles.galleryLink}>
          <Ionicons name="images-outline" size={18} color={colors.primary} />
          <Text style={styles.galleryText}>Choose from gallery</Text>
        </Pressable>
      </View>

      {queue.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={styles.section}>Waiting to sync · {queue.length}</Text>
          {queue.map((item) => (
            <QueueRow key={item.localId} item={item} />
          ))}
        </View>
      )}

      <View style={styles.tabs}>
        <TabButton label="Receipts" badge={toCheck} active={tab === 'receipts'} onPress={() => setTab('receipts')} />
        <TabButton label="Open orders" badge={orders.length} active={tab === 'orders'} onPress={() => setTab('orders')} />
      </View>

      {!loaded ? (
        <View style={{ gap: 10 }}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </View>
      ) : tab === 'receipts' ? (
        <>
          <View style={styles.filters}>
            {([['all', 'All'], ['check', 'To check'], ['done', 'Done']] as const).map(([key, label]) => (
              <Pressable key={key} onPress={() => { tap(); setFilter(key); }} style={[styles.filter, filter === key && styles.filterOn]}>
                <Text style={[styles.filterText, filter === key && { color: '#fff' }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {shown.length === 0 && (
            <EmptyState
              icon="document-text-outline"
              title={receipts.length === 0 ? 'No deliveries yet' : 'Nothing here'}
              hint={receipts.length === 0 ? 'Photograph a delivery note to start.' : 'Try another filter.'}
            />
          )}
          {shown.map((r) => (
            <ReceiptCard key={r.id} receipt={r} onPress={() => onOpenReceipt(r.id)} />
          ))}
        </>
      ) : (
        <>
          {orders.length === 0 && <EmptyState icon="file-tray-outline" title="No open orders" />}
          {orders.map((po) => (
            <View key={po.id} style={[styles.card, shadow]}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>{po.poNumber}</Text>
                <Text style={styles.muted}>{po.lines.length} lines</Text>
              </View>
              <Text style={styles.muted}>{po.supplier}</Text>
              <View style={styles.divider} />
              {po.lines.map((l) => (
                <View key={l.id} style={styles.row}>
                  <Text style={styles.lineName}>{l.description}</Text>
                  <Text style={styles.lineQty}>
                    {l.orderedQty} {l.unit}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function TabButton({ label, badge, active, onPress }: { label: string; badge: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={[styles.tab, active && styles.tabOn]}>
      <Text style={[styles.tabText, active && { color: colors.ink }]}>{label}</Text>
      {badge > 0 && (
        <View style={[styles.badge, active && { backgroundColor: colors.primary }]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

function ReceiptCard({ receipt: r, onPress }: { receipt: Receipt; onPress: () => void }) {
  const s = statusStyle[r.status];
  const decided = r.status === 'CONFIRMED' || r.status === 'DISPUTED';
  const issues = issueCount(r);
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.card, shadow, styles.receiptCard, pressed && { opacity: 0.85 }]}>
      <View style={[styles.stripe, { backgroundColor: s.color }]} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={styles.row}>
          <Text style={styles.cardTitle} numberOfLines={1}>{r.supplier ?? 'Unknown supplier'}</Text>
          <Pill label={s.label} color={s.color} soft={s.soft} />
        </View>
        <Text style={styles.muted}>
          {r.poNumber ?? 'PO not matched'} · {r.id} · {timeAgo(r.createdAt)}
        </Text>
        {r.status === 'EXTRACTED' && (
          <Text style={[styles.summary, { color: issues === 0 && !r.needsReview ? colors.good : colors.warn }]}>
            {issues === 0 ? (r.needsReview ? 'Matches, but please check the reading' : 'Everything matches the order') : `${issues} ${issues === 1 ? 'line differs' : 'lines differ'} from the order`}
          </Text>
        )}
        {r.status === 'NEEDS_MANUAL' && <Text style={[styles.summary, { color: colors.warn }]}>Could not read the note. Tap to enter it.</Text>}
        {decided && r.status === 'DISPUTED' && <Text style={[styles.summary, { color: colors.bad }]} numberOfLines={1}>{r.disputeReason}</Text>}
      </View>
    </Pressable>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  const failed = item.state === 'failed';
  const label = failed ? 'Could not upload' : item.state === 'syncing' ? 'Uploading…' : 'Waiting for signal';
  const color = failed ? colors.bad : item.state === 'syncing' ? colors.primary : colors.warn;
  return (
    <View style={[styles.card, shadow, { gap: 10 }]}>
      <View style={styles.queueTop}>
        <Image source={{ uri: item.photoUri }} style={styles.thumb} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.cardTitle, { color }]}>{label}</Text>
          <Text style={styles.muted}>
            Photographed {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {item.attempts > 0 ? ` · tried ${item.attempts}×` : ''}
          </Text>
          {failed && item.lastError && <Text style={styles.muted}>{item.lastError}</Text>}
        </View>
        {!failed && <Ionicons name={item.state === 'syncing' ? 'cloud-upload' : 'time'} size={26} color={color} />}
      </View>
      {failed && (
        <View style={styles.queueActions}>
          <View style={{ flex: 1 }}>
            <Button small title="Try again" icon="refresh" onPress={() => void retry(item.localId)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              small
              title="Delete"
              icon="trash"
              kind="dangerOutline"
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
  content: { paddingHorizontal: 16, gap: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontSize: 30, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 1 },
  conn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  dot: { width: 8, height: 8, borderRadius: 4 },
  connText: { fontSize: 13, fontWeight: '700' },
  hero: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 18, gap: 12 },
  heroTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  heroText: { fontSize: 15, color: colors.muted, lineHeight: 21, marginTop: -6 },
  galleryLink: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  galleryText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  section: { fontSize: 17, fontWeight: '800', color: colors.ink },
  tabs: { flexDirection: 'row', backgroundColor: '#E4E8F0', borderRadius: radius.md, padding: 4, marginTop: 4 },
  tab: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: radius.md - 4 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { fontSize: 15, fontWeight: '700', color: colors.muted },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  filters: { flexDirection: 'row', gap: 8 },
  filter: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  filterOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterText: { fontSize: 14, fontWeight: '700', color: colors.ink2 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, gap: 6 },
  receiptCard: { flexDirection: 'row', gap: 12, overflow: 'hidden' },
  stripe: { width: 5, borderRadius: 3, marginVertical: -2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  muted: { color: colors.muted, fontSize: 14 },
  summary: { fontSize: 14, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
  lineName: { fontSize: 15, color: colors.ink2, flexShrink: 1 },
  lineQty: { fontSize: 15, fontWeight: '700', color: colors.ink },
  queueTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: '#E1E4E8' },
  queueActions: { flexDirection: 'row', gap: 10 },
});
