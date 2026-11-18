import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

export const tap = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
export const buzz = (kind: 'success' | 'warning') =>
  void Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});

export function Button({
  title, onPress, kind = 'primary', icon, disabled, busy, small,
}: {
  title: string; onPress: () => void; kind?: 'primary' | 'success' | 'danger' | 'outline' | 'dangerOutline' | 'ghost';
  icon?: Icon; disabled?: boolean; busy?: boolean; small?: boolean;
}) {
  const solid = { primary: colors.primary, success: colors.good, danger: colors.bad }[kind as 'primary'] as string | undefined;
  const outlineColor = kind === 'dangerOutline' ? colors.bad : colors.primary;
  const fg = solid ? '#fff' : outlineColor;
  const off = disabled || busy;
  return (
    <Pressable
      onPress={() => { tap(); onPress(); }}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        small && { minHeight: 44 },
        solid ? { backgroundColor: solid } : kind === 'ghost' ? null : { borderWidth: 2, borderColor: outlineColor, backgroundColor: '#fff' },
        { opacity: off ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon && <Ionicons name={icon} size={small ? 18 : 22} color={fg} />}
          <Text style={[styles.buttonText, small && { fontSize: 15 }, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Pill({ label, color, soft, icon }: { label: string; color: string; soft: string; icon?: Icon }) {
  return (
    <View style={[styles.pill, { backgroundColor: soft }]}>
      {icon && <Ionicons name={icon} size={14} color={color} />}
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function Banner({
  text, kind = 'warn', icon, action,
}: { text: string; kind?: 'warn' | 'bad' | 'info' | 'good'; icon?: Icon; action?: { label: string; onPress: () => void } }) {
  const c = { warn: [colors.warn, colors.warnSoft], bad: [colors.bad, colors.badSoft], info: [colors.primary, colors.primarySoft], good: [colors.good, colors.goodSoft] }[kind];
  const defaultIcon: Icon = kind === 'bad' ? 'alert-circle' : kind === 'good' ? 'checkmark-circle' : kind === 'info' ? 'information-circle' : 'warning';
  return (
    <View style={[styles.banner, { backgroundColor: c[1] }]}>
      <Ionicons name={icon ?? defaultIcon} size={22} color={c[0]} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={[styles.bannerText, { color: c[0] }]}>{text}</Text>
        {action && (
          <Pressable onPress={action.onPress} hitSlop={10}>
            <Text style={[styles.bannerAction, { color: c[0] }]}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** A short message that fades away, for "Saved" style feedback that should not need a tap to dismiss. */
export function Toast({ toast }: { toast: { text: string; n: number } | null }) {
  const opacity = useRef(new Animated.Value(0)).current;
  // `n` changes on every show, so the same text twice in a row still animates again.
  useEffect(() => {
    if (!toast) return;
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [toast, opacity]);
  if (!toast) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
      <Ionicons name="checkmark-circle" size={20} color="#fff" />
      <Text style={styles.toastText}>{toast.text}</Text>
    </Animated.View>
  );
}

/** Grey placeholder block shown while the first load is in flight, instead of an empty screen. */
export function Skeleton({ height = 76 }: { height?: number }) {
  const o = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={{ height, borderRadius: radius.md, backgroundColor: '#E1E5EC', opacity: o }} />;
}

export function EmptyState({ icon, title, hint }: { icon: Icon; title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.line} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint && <Text style={styles.emptyHint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { fontSize: 17, fontWeight: '700' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  pillText: { fontSize: 13, fontWeight: '700' },
  banner: { flexDirection: 'row', gap: 10, borderRadius: radius.md, padding: 14 },
  bannerText: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  bannerAction: { fontSize: 15, fontWeight: '800', textDecorationLine: 'underline' },
  toast: {
    position: 'absolute', top: 60, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#101828', borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10, zIndex: 50,
  },
  toastText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 36 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.ink2 },
  emptyHint: { fontSize: 14, color: colors.muted, textAlign: 'center', paddingHorizontal: 24 },
});
