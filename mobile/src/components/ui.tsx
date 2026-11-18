import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ReceiptLine } from '../api';
import { colors, discrepancyStyle } from '../theme';

export function DiscrepancyChip({ line }: { line: ReceiptLine }) {
  const s = discrepancyStyle[line.discrepancy];
  const delta = line.delta != null && line.delta !== 0 ? ` ${line.delta > 0 ? '+' : ''}${line.delta}` : '';
  return (
    <View style={[styles.chip, { backgroundColor: s.color }]}>
      <Text style={styles.chipText}>
        {s.label}
        {line.discrepancy === 'SHORT' || line.discrepancy === 'OVER' ? delta : ''}
      </Text>
    </View>
  );
}

export function Button({
  title, onPress, kind = 'primary', disabled, busy,
}: { title: string; onPress: () => void; kind?: 'primary' | 'danger' | 'ghost'; disabled?: boolean; busy?: boolean }) {
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.bad : 'transparent';
  const fg = kind === 'ghost' ? colors.primary : '#fff';
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'ghost' && { borderWidth: 2, borderColor: colors.primary },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Banner({ text, kind = 'warn', action }: { text: string; kind?: 'warn' | 'bad' | 'info'; action?: { label: string; onPress: () => void } }) {
  const c = kind === 'bad' ? colors.bad : kind === 'info' ? colors.primary : colors.warn;
  return (
    <View style={[styles.banner, { borderColor: c }]}>
      <Text style={[styles.bannerText, { color: c }]}>{text}</Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={[styles.bannerAction, { color: c }]}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  chipText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  button: { minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 17, fontWeight: '700' },
  banner: { borderWidth: 2, borderRadius: 10, padding: 12, backgroundColor: '#fff', gap: 6 },
  bannerText: { fontSize: 15, fontWeight: '600' },
  bannerAction: { fontSize: 15, fontWeight: '800', textDecorationLine: 'underline' },
});
