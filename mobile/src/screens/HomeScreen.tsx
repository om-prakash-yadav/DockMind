import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, ApiError, PurchaseOrder, Receipt } from '../api';
import { pickPhoto } from '../capture';
import { Banner, Button } from '../components/ui';
import { colors, statusStyle } from '../theme';

export default function HomeScreen({ onOpenReceipt }: { onOpenReceipt: (id: string) => void }) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [po, rc] = await Promise.all([api.openPurchaseOrders(), api.receipts()]);
      setOrders(po);
      setReceipts(rc);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const capture = async (source: 'camera' | 'gallery') => {
    try {
      const photo = await pickPhoto(source);
      if (!photo) return;
      setSending(true);
      const receipt = await api.createReceipt(photo.uri, photo.filename, photo.idempotencyKey);
      onOpenReceipt(receipt.id);
    } catch (e: any) {
      Alert.alert('Could not send the photo', e?.message ?? 'Try again.');
    } finally {
      setSending(false);
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

      <View style={styles.actions}>
        <Button title="Photograph delivery note" onPress={() => capture('camera')} busy={sending} />
        <Button title="Choose from gallery" kind="ghost" onPress={() => capture('gallery')} disabled={sending} />
      </View>

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
});
