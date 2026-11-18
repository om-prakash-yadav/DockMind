import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, PurchaseOrder, Receipt, ReceiptLine } from '../api';
import { Banner, Button, buzz, Pill, Skeleton, tap, Toast } from '../components/ui';
import { colors, discrepancyStyle, issueCount, pct, radius, shadow, statusStyle } from '../theme';

const POLL_MS = 1500;
const SLOW_AFTER_MS = 20000;
const isDecided = (r: Receipt) => r.status === 'CONFIRMED' || r.status === 'DISPUTED';

export default function ReceiptScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ReceiptLine | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
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

  const needsPo = !!receipt && !reading && receipt.poNumber == null && !isDecided(receipt);
  useEffect(() => {
    if (needsPo && orders == null) api.openPurchaseOrders().then(setOrders).catch(() => setOrders([]));
  }, [needsPo, orders]);

  // Problems first, so the clerk sees what is wrong without scrolling.
  const lines = useMemo(
    () => [...(receipt?.lines ?? [])].sort((a, b) => discrepancyStyle[a.discrepancy].rank - discrepancyStyle[b.discrepancy].rank),
    [receipt],
  );

  /** Runs a server action and turns failures into messages a clerk understands. */
  const act = async (fn: () => Promise<Receipt>, done?: string) => {
    setBusy(true);
    try {
      setReceipt(await fn());
      setError(null);
      if (done) {
        buzz('success');
        setToast({ text: done, n: Date.now() });
      }
    } catch (e) {
      buzz('warning');
      Alert.alert('Not done', e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      // Another delivery was confirmed meanwhile: the server has refreshed the numbers, so show them.
      if (e instanceof ApiError && e.code === 'OUTSTANDING_CHANGED') await load();
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!receipt) return;
    if (!receipt.needsReview) return void act(() => api.confirm(receipt.id, false), 'Delivery confirmed');
    Alert.alert('Check before confirming', 'Some lines are low confidence or not matched. Have you checked them against the delivery?', [
      { text: 'Go back', style: 'cancel' },
      { text: 'Yes, confirm', onPress: () => act(() => api.confirm(receipt.id, true), 'Delivery confirmed') },
    ]);
  };

  if (!receipt) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 12, paddingHorizontal: 16, gap: 12 }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backRow}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={styles.backText}>Receipts</Text>
        </Pressable>
        {error ? (
          <Banner kind="bad" text={error} action={{ label: 'Try again', onPress: load }} />
        ) : (
          <>
            <Skeleton height={90} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </>
        )}
      </View>
    );
  }

  const s = statusStyle[receipt.status];
  const decided = isDecided(receipt);
  const issues = issueCount(receipt);
  const total = receipt.lines.length;
  const showBar = !decided && !reading;

  return (
    <View style={styles.screen}>
      <Toast toast={toast} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: (showBar ? 150 : 40) + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={onBack} hitSlop={12} style={styles.backRow}>
            <Ionicons name="chevron-back" size={24} color={colors.primary} />
            <Text style={styles.backText}>Receipts</Text>
          </Pressable>

          <View style={[styles.summary, shadow]}>
            <View style={styles.row}>
              <Text style={styles.title} numberOfLines={2}>{receipt.supplier ?? 'Delivery note'}</Text>
              <Pill label={s.label} color={s.color} soft={s.soft} />
            </View>
            <View style={styles.metaRow}>
              <Meta icon="document-text-outline" text={receipt.poNumber ?? 'PO not matched'} />
              {receipt.deliveryNoteNo && <Meta icon="receipt-outline" text={receipt.deliveryNoteNo} />}
              <Meta icon="eye-outline" text={`Read ${pct(receipt.overallConfidence)} sure`} />
            </View>
            {!reading && total > 0 && (
              <View style={[styles.verdict, { backgroundColor: issues === 0 ? colors.goodSoft : colors.warnSoft }]}>
                <Ionicons name={issues === 0 ? 'checkmark-circle' : 'alert-circle'} size={22} color={issues === 0 ? colors.good : colors.warn} />
                <Text style={[styles.verdictText, { color: issues === 0 ? colors.good : colors.warn }]}>
                  {issues === 0 ? 'Everything matches the order' : `${issues} of ${total} lines differ from the order`}
                </Text>
              </View>
            )}
          </View>

          {error && <Banner kind="bad" text={error} action={{ label: 'Try again', onPress: load }} />}

          {reading && (
            <View style={[styles.reading, shadow]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.readingTitle}>Reading the note…</Text>
              <Text style={styles.muted}>Usually a few seconds.</Text>
              {slow && <Text style={[styles.muted, { color: colors.warn, fontWeight: '700' }]}>Taking longer than usual. It will keep trying.</Text>}
            </View>
          )}

          {receipt.status === 'CONFIRMED' && <Banner kind="good" text="Confirmed. This delivery is recorded as received." />}
          {receipt.status === 'DISPUTED' && <Banner kind="bad" icon="flag" text={`Disputed: ${receipt.disputeReason ?? ''}`} />}

          {receipt.aiNote && !reading && (
            <View style={styles.note}>
              <Ionicons name="sparkles" size={18} color={colors.primary} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.noteLabel}>What the reader noticed</Text>
                <Text style={styles.noteText}>{receipt.aiNote}</Text>
              </View>
            </View>
          )}

          {receipt.status === 'NEEDS_MANUAL' && <Banner text="The note could not be read automatically. Choose the purchase order, then enter what arrived." />}

          {needsPo && (
            <View style={[styles.card, shadow, { gap: 10 }]}>
              <Text style={styles.cardTitle}>Which purchase order is this?</Text>
              {receipt.poNumberRead && (
                <Text style={styles.muted}>The note seems to say {receipt.poNumberRead}, but that does not fit the supplier. Please check the paper.</Text>
              )}
              {orders == null && <ActivityIndicator />}
              {orders?.map((po) => (
                <Button key={po.id} kind="outline" title={`${po.poNumber} · ${po.supplier}`} disabled={busy} onPress={() => act(() => api.assignPo(receipt.id, po.poNumber), 'Order selected')} />
              ))}
            </View>
          )}

          {lines.map((line) => (
            <LineCard key={line.id} line={line} editable={!decided && !reading} onEdit={() => { tap(); setEditing(line); }} />
          ))}

          {receipt.freeText && (
            <View style={styles.freeText}>
              <Ionicons name="create-outline" size={18} color={colors.muted} />
              <Text style={[styles.muted, { flex: 1 }]}>Also written on the note: {receipt.freeText}</Text>
            </View>
          )}

          {!reading && (
            <Pressable onPress={() => { tap(); setViewing(true); }} style={[styles.photoRow, shadow]}>
              <Image source={{ uri: api.imageUrl(receipt.id) }} style={styles.photoThumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Photo of the note</Text>
                <Text style={styles.muted}>Tap to view full screen</Text>
              </View>
              <Ionicons name="expand" size={22} color={colors.muted} />
            </Pressable>
          )}
        </ScrollView>

        {showBar && (
          <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {receipt.needsReview && receipt.poNumber != null && (
              <Text style={styles.barHint}>
                <Ionicons name="alert-circle" size={14} color={colors.warn} /> Some lines are low confidence. Look at them first.
              </Text>
            )}
            <View style={styles.barButtons}>
              <View style={{ flex: 1 }}>
                <Button title="Dispute" icon="flag" kind="dangerOutline" onPress={() => setDisputing(true)} disabled={busy} />
              </View>
              <View style={{ flex: 1.4 }}>
                <Button title={receipt.needsReview ? 'Check & confirm' : 'Confirm'} icon="checkmark-circle" kind="success" onPress={confirm} busy={busy} disabled={receipt.poNumber == null} />
              </View>
            </View>
            {receipt.poNumber == null && <Text style={styles.barHint}>Choose the purchase order above to confirm.</Text>}
          </View>
        )}
      </KeyboardAvoidingView>

      <QuantityModal
        line={editing}
        onClose={() => setEditing(null)}
        onSave={(qty) => {
          const line = editing!;
          setEditing(null);
          act(() => api.correctLine(receipt.id, line.id, qty), 'Quantity updated');
        }}
      />
      <DisputeModal
        visible={disputing}
        onClose={() => setDisputing(false)}
        onSubmit={(reason) => {
          setDisputing(false);
          act(() => api.dispute(receipt.id, reason), 'Dispute sent');
        }}
      />
      <Modal visible={viewing} animationType="fade" onRequestClose={() => setViewing(false)}>
        <View style={styles.viewer}>
          <Image source={{ uri: api.imageUrl(receipt.id) }} style={{ flex: 1 }} resizeMode="contain" />
          <Pressable onPress={() => setViewing(false)} style={[styles.viewerClose, { top: insets.top + 12 }]} hitSlop={12}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

function Meta({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={15} color={colors.muted} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

function LineCard({ line, editable, onEdit }: { line: ReceiptLine; editable: boolean; onEdit: () => void }) {
  const d = discrepancyStyle[line.discrepancy];
  const delta = line.delta != null && line.delta !== 0 && (line.discrepancy === 'SHORT' || line.discrepancy === 'OVER') ? ` ${line.delta > 0 ? '+' : ''}${line.delta}` : '';
  const partial = (line.previouslyReceivedQty ?? 0) > 0;
  const trips = partial ? `Ordered ${line.orderedQty} ${line.unit ?? ''}, ${line.previouslyReceivedQty} already received.` : null;
  const note = line.missingFromNote
    ? 'On the order, but not on the note'
    : line.corrected
      ? 'Corrected by you'
      : line.needsReview
        ? `Hard to read (${pct(line.confidence)} sure). Please check.`
        : null;
  return (
    <Pressable onPress={editable ? onEdit : undefined} style={({ pressed }) => [styles.card, shadow, styles.lineCard, pressed && editable && { opacity: 0.85 }]}>
      <View style={[styles.stripe, { backgroundColor: d.color }]} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>{line.description}</Text>
          <Pill label={d.label + delta} color={d.color} soft={d.soft} icon={d.icon} />
        </View>
        <View style={styles.qtyRow}>
          <View style={styles.qtyBox}>
            {/* After earlier trips, compare with what is still to come, not the full order. */}
            <Text style={styles.qtyLabel}>{partial ? 'Still to come' : 'Ordered'}</Text>
            <Text style={styles.qty}>{line.remainingQty != null ? `${line.remainingQty} ${line.unit ?? ''}` : '–'}</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={colors.muted} />
          <View style={[styles.qtyBox, { backgroundColor: d.soft }]}>
            <Text style={styles.qtyLabel}>Received</Text>
            <Text style={[styles.qty, { color: d.color }]}>{line.receivedQty} {line.unit ?? ''}</Text>
          </View>
          {editable && (
            <View style={styles.editBtn}>
              <Ionicons name="create-outline" size={22} color={colors.primary} />
            </View>
          )}
        </View>
        {trips && <Text style={styles.lineNote}>{trips}</Text>}
        {note && (
          <Text style={[styles.lineNote, line.needsReview && !line.corrected && { color: colors.warn, fontWeight: '700' }]}>{note}</Text>
        )}
      </View>
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
  const step = (by: number) => {
    tap();
    setText(String(Math.max(0, Math.round(((valid ? qty : 0) + by) * 1000) / 1000)));
  };
  return (
    <Modal visible={!!line} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBack} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>{line?.description}</Text>
          <Text style={styles.muted}>
            How many {line?.unit ?? 'units'} actually arrived?
            {line?.remainingQty != null ? ` Still to come on the order: ${line.remainingQty}.` : ''}
          </Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => step(-1)} style={styles.stepBtn} accessibilityLabel="One less"><Ionicons name="remove" size={30} color={colors.ink} /></Pressable>
            <TextInput style={styles.input} value={text} onChangeText={setText} keyboardType="decimal-pad" selectTextOnFocus />
            <Pressable onPress={() => step(1)} style={styles.stepBtn} accessibilityLabel="One more"><Ionicons name="add" size={30} color={colors.ink} /></Pressable>
          </View>
          {line?.remainingQty != null && (
            <Pressable onPress={() => { tap(); setText(String(line.remainingQty)); }} hitSlop={8}>
              <Text style={styles.linkText}>
                {(line.previouslyReceivedQty ?? 0) > 0 ? 'Same as still to come' : 'Same as ordered'} ({line.remainingQty})
              </Text>
            </Pressable>
          )}
          <Button title="Save" icon="checkmark" onPress={() => onSave(qty)} disabled={!valid} />
          <Button title="Cancel" kind="ghost" onPress={onClose} small />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const REASONS = ['Short delivery', 'Wrong item', 'Damaged goods', 'Not ordered'];

function DisputeModal({ visible, onClose, onSubmit }: { visible: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBack} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Dispute this delivery</Text>
          <Text style={styles.muted}>Tell the office what is wrong.</Text>
          <View style={styles.reasons}>
            {REASONS.map((r) => (
              <Pressable key={r} onPress={() => { tap(); setReason((cur) => (cur ? `${cur}. ${r}` : r)); }} style={styles.reasonChip}>
                <Text style={styles.reasonText}>{r}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder="e.g. Salmon 8 kg short, crates damaged"
            placeholderTextColor={colors.muted}
          />
          <Button title="Send dispute" icon="flag" kind="danger" onPress={() => onSubmit(reason)} disabled={reason.trim() === ''} />
          <Button title="Cancel" kind="ghost" onPress={onClose} small />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, gap: 12 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginLeft: -6, alignSelf: 'flex-start' },
  backText: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  summary: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 10 },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink, flex: 1, letterSpacing: -0.3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 14, color: colors.ink2, fontWeight: '600' },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, padding: 12 },
  verdictText: { fontSize: 15, fontWeight: '800', flex: 1 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  reading: { backgroundColor: colors.card, borderRadius: radius.lg, alignItems: 'center', gap: 8, padding: 28 },
  readingTitle: { fontSize: 19, fontWeight: '800', color: colors.ink },
  note: { flexDirection: 'row', gap: 10, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 14 },
  noteLabel: { fontSize: 12, fontWeight: '800', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  noteText: { fontSize: 15, color: colors.ink, lineHeight: 21, marginTop: 2 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  lineCard: { flexDirection: 'row', gap: 12, overflow: 'hidden' },
  stripe: { width: 5, borderRadius: 3, marginVertical: -2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBox: { backgroundColor: '#F2F4F8', borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, minWidth: 96 },
  qtyLabel: { fontSize: 11, color: colors.muted, textTransform: 'uppercase', fontWeight: '800', letterSpacing: 0.5 },
  qty: { fontSize: 19, fontWeight: '800', color: colors.ink },
  editBtn: { marginLeft: 'auto', width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  lineNote: { fontSize: 13, color: colors.muted },
  freeText: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 4 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: radius.md, padding: 10 },
  photoThumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: '#E1E4E8' },
  bar: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  barButtons: { flexDirection: 'row', gap: 10 },
  barHint: { fontSize: 13, color: colors.warn, fontWeight: '700', textAlign: 'center' },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerClose: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  modalBack: { flex: 1, backgroundColor: 'rgba(16,24,40,0.55)', justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 20, gap: 14 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: '#F2F4F8', alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, borderWidth: 2, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 26, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  textArea: { fontSize: 17, fontWeight: '500', minHeight: 96, textAlign: 'left', textAlignVertical: 'top', flex: 0 },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: { backgroundColor: colors.badSoft, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  reasonText: { color: colors.bad, fontWeight: '700', fontSize: 14 },
});
