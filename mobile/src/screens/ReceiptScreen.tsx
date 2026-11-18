import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { api, ApiError, PurchaseOrder, Receipt, ReceiptLine } from '../api';
import { Banner, Button, DiscrepancyChip } from '../components/ui';
import { colors, pct, statusStyle } from '../theme';

const POLL_MS = 1500;
const SLOW_AFTER_MS = 20000;

export default function ReceiptScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ReceiptLine | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const startedAt = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      setReceipt(await api.receipt(id));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this receipt.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // While the server is still reading the photo, ask again until it is done.
  const reading = receipt?.status === 'CAPTURED';
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => {
      load();
      setSlow(Date.now() - startedAt.current > SLOW_AFTER_MS);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [reading, load]);

  // Offer the PO picker when the receipt has no PO.
  const needsPo = !!receipt && !reading && receipt.poNumber == null && !isDecided(receipt);
  useEffect(() => {
    if (needsPo && orders == null) api.openPurchaseOrders().then(setOrders).catch(() => setOrders([]));
  }, [needsPo, orders]);

  /** Runs a server action, shows its result, and turns failures into messages a clerk understands. */
  const act = async (fn: () => Promise<Receipt>) => {
    setBusy(true);
    try {
      setReceipt(await fn());
      setError(null);
    } catch (e) {
      Alert.alert('Not done', e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!receipt) return;
    if (!receipt.needsReview) return void act(() => api.confirm(receipt.id, false));
    Alert.alert('Check before confirming', 'Some lines are low confidence or not matched. Have you checked them against the delivery?', [
      { text: 'Go back', style: 'cancel' },
      { text: 'Yes, confirm', onPress: () => act(() => api.confirm(receipt.id, true)) },
    ]);
  };

  if (!receipt) {
    return (
      <View style={styles.center}>
        {error ? (
          <>
            <Banner kind="bad" text={error} action={{ label: 'Try again', onPress: load }} />
            <Button title="Back" kind="ghost" onPress={onBack} />
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }

  const s = statusStyle[receipt.status];
  const decided = isDecided(receipt);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ All receipts</Text>
        </Pressable>
        <View style={styles.row}>
          <Text style={styles.title}>{receipt.supplier ?? 'Delivery note'}</Text>
          <Text style={[styles.status, { color: s.color }]}>{s.label}</Text>
        </View>
        <Text style={styles.muted}>
          {receipt.id}
          {receipt.deliveryNoteNo ? ` · ${receipt.deliveryNoteNo}` : ''} · {receipt.poNumber ?? 'PO not matched'}
          {receipt.overallConfidence != null ? ` · read ${pct(receipt.overallConfidence)} sure` : ''}
        </Text>

        {error && <Banner kind="bad" text={error} action={{ label: 'Try again', onPress: load }} />}

        {reading && (
          <View style={styles.reading}>
            <ActivityIndicator size="large" />
            <Text style={styles.readingText}>Reading the note…</Text>
            {slow && <Text style={styles.muted}>This is taking longer than usual. It will keep trying.</Text>}
          </View>
        )}

        {receipt.status === 'CONFIRMED' && <Banner kind="info" text="Confirmed. This delivery is recorded as received." />}
        {receipt.status === 'DISPUTED' && <Banner kind="bad" text={`Disputed: ${receipt.disputeReason ?? ''}`} />}

        {receipt.aiNote && !reading && (
          <View style={styles.note}>
            <Text style={styles.noteLabel}>What the reader noticed</Text>
            <Text style={styles.noteText}>{receipt.aiNote}</Text>
          </View>
        )}

        {receipt.status === 'NEEDS_MANUAL' && (
          <Banner text="The note could not be read automatically. Choose the purchase order, then enter what arrived." />
        )}

        {needsPo && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Which purchase order is this?</Text>
            {receipt.poNumberRead && (
              <Text style={styles.muted}>The note seems to say {receipt.poNumberRead}, but it does not fit the supplier. Please check the paper.</Text>
            )}
            {orders == null && <ActivityIndicator />}
            {orders?.map((po) => (
              <Button key={po.id} title={`${po.poNumber} · ${po.supplier}`} kind="ghost" disabled={busy}
                onPress={() => act(() => api.assignPo(receipt.id, po.poNumber))} />
            ))}
          </View>
        )}

        {receipt.lines.map((line) => (
          <LineCard key={line.id} line={line} editable={!decided && !reading} onEdit={() => setEditing(line)} />
        ))}

        {receipt.freeText && <Text style={styles.muted}>Also written on the note: {receipt.freeText}</Text>}

        {!reading && (
          <>
            <Text style={styles.photoLabel}>Photo of the note</Text>
            <Image source={{ uri: api.imageUrl(receipt.id) }} style={styles.photo} resizeMode="contain" />
          </>
        )}

        {!decided && !reading && (
          <View style={styles.decide}>
            {receipt.needsReview && receipt.poNumber != null && (
              <Banner text="Some lines are low confidence. Look at them before you confirm." />
            )}
            <Button title="Confirm delivery" onPress={confirm} busy={busy} disabled={receipt.poNumber == null} />
            <Button title="Dispute" kind="danger" onPress={() => setDisputing(true)} disabled={busy} />
          </View>
        )}
      </ScrollView>

      <QuantityModal
        line={editing}
        onClose={() => setEditing(null)}
        onSave={(qty) => {
          const line = editing!;
          setEditing(null);
          act(() => api.correctLine(receipt.id, line.id, qty));
        }}
      />
      <DisputeModal
        visible={disputing}
        onClose={() => setDisputing(false)}
        onSubmit={(reason) => {
          setDisputing(false);
          act(() => api.dispute(receipt.id, reason));
        }}
      />
    </KeyboardAvoidingView>
  );
}

const isDecided = (r: Receipt) => r.status === 'CONFIRMED' || r.status === 'DISPUTED';

function LineCard({ line, editable, onEdit }: { line: ReceiptLine; editable: boolean; onEdit: () => void }) {
  return (
    <Pressable
      onPress={editable ? onEdit : undefined}
      style={[styles.card, line.needsReview && { borderColor: colors.warn, borderWidth: 2 }]}
    >
      <View style={styles.row}>
        <Text style={styles.cardTitle}>{line.description}</Text>
        <DiscrepancyChip line={line} />
      </View>
      <View style={styles.qtyRow}>
        <View>
          <Text style={styles.qtyLabel}>Ordered</Text>
          <Text style={styles.qty}>{line.orderedQty != null ? `${line.orderedQty} ${line.unit ?? ''}` : '–'}</Text>
        </View>
        <View>
          <Text style={styles.qtyLabel}>Received</Text>
          <Text style={styles.qty}>
            {line.receivedQty} {line.unit ?? ''}
          </Text>
        </View>
      </View>
      <Text style={styles.muted}>
        {line.missingFromNote
          ? 'On the order but not on the note'
          : line.corrected
            ? 'Corrected by you'
            : `Confidence ${pct(line.confidence)}${line.needsReview ? ' · please check' : ''}`}
        {editable ? '  ·  tap to correct' : ''}
      </Text>
    </Pressable>
  );
}

function QuantityModal({ line, onClose, onSave }: { line: ReceiptLine | null; onClose: () => void; onSave: (qty: number) => void }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (line) setText(String(line.receivedQty));
  }, [line]);
  const qty = Number(text.replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(qty) && qty >= 0;
  return (
    <Modal visible={!!line} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBack}>
        <View style={styles.modal}>
          <Text style={styles.cardTitle}>{line?.description}</Text>
          <Text style={styles.muted}>How many {line?.unit ?? ''} actually arrived?</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            autoFocus
            selectTextOnFocus
          />
          <Button title="Save" onPress={() => onSave(qty)} disabled={!valid} />
          <Button title="Cancel" kind="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function DisputeModal({ visible, onClose, onSubmit }: { visible: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBack}>
        <View style={styles.modal}>
          <Text style={styles.cardTitle}>Why are you disputing this delivery?</Text>
          <TextInput style={[styles.input, { height: 100, textAlignVertical: 'top' }]} value={reason} onChangeText={setReason}
            multiline placeholder="e.g. Salmon 8 kg short, crates damaged" autoFocus />
          <Button title="Send dispute" kind="danger" onPress={() => onSubmit(reason)} disabled={reason.trim() === ''} />
          <Button title="Cancel" kind="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingTop: 56, gap: 10, paddingBottom: 60 },
  center: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: colors.bg },
  back: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  status: { fontSize: 14, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14 },
  reading: { alignItems: 'center', gap: 10, padding: 24 },
  readingText: { fontSize: 18, fontWeight: '700', color: colors.ink },
  note: { backgroundColor: '#EAF1FD', borderRadius: 10, padding: 12, gap: 4 },
  noteLabel: { fontSize: 12, fontWeight: '800', color: colors.primary, textTransform: 'uppercase' },
  noteText: { fontSize: 16, color: colors.ink },
  card: { backgroundColor: colors.card, borderRadius: 10, padding: 14, gap: 8, borderWidth: 1, borderColor: colors.line },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  qtyRow: { flexDirection: 'row', gap: 32 },
  qtyLabel: { fontSize: 12, color: colors.muted, textTransform: 'uppercase', fontWeight: '700' },
  qty: { fontSize: 22, fontWeight: '800', color: colors.ink },
  photoLabel: { fontSize: 16, fontWeight: '800', color: colors.ink, marginTop: 8 },
  photo: { width: '100%', height: 320, backgroundColor: '#E1E4E8', borderRadius: 10 },
  decide: { gap: 10, marginTop: 8 },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: '#fff', borderRadius: 14, padding: 18, gap: 12 },
  input: { borderWidth: 2, borderColor: colors.line, borderRadius: 10, padding: 12, fontSize: 24, fontWeight: '700', color: colors.ink },
});
