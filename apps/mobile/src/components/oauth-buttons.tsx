import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { googleAvailable, OAuthUnavailableError, zaloAvailable } from '@/lib/oauth';

type Provider = 'google' | 'zalo';

type Props = {
  /** Chữ trên đường kẻ, ví dụ "HOẶC TIẾP TỤC VỚI". */
  label: string;
  /** Form email đang gửi: khóa các nút. */
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** null = xóa lỗi cũ; chuỗi = thông báo tiếng Việt để hiện bằng Notice. */
  onError: (message: string | null) => void;
};

/** Nút đăng nhập Google / Zalo dùng chung cho màn đăng nhập và đăng ký (F11). */
export function OAuthButtons({ label, disabled, onBusyChange, onError }: Props) {
  const { loginWithGoogle, loginWithZalo } = useAuth();
  const [pending, setPending] = useState<Provider | null>(null);
  // Khóa đồng bộ: hai lần bấm trong cùng một tick đều thấy `pending` cũ (chưa vẽ lại).
  const busy = useRef(false);

  if (!googleAvailable && !zaloAvailable) return null;

  async function start(provider: Provider) {
    if (busy.current || disabled) return;
    busy.current = true;
    setPending(provider);
    onBusyChange?.(true);
    onError(null);
    try {
      await (provider === 'google' ? loginWithGoogle() : loginWithZalo());
      // Vào phiên xong, Stack.Protected ở layout gốc tự chuyển sang app; hủy thì không làm gì.
    } catch (error) {
      onError(
        error instanceof ApiError || error instanceof OAuthUnavailableError
          ? error.message
          : 'Không đăng nhập được. Thử lại sau ít phút.',
      );
    } finally {
      busy.current = false;
      setPending(null);
      onBusyChange?.(false);
    }
  }

  const locked = !!disabled || pending !== null;
  return (
    <View style={styles.section}>
      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerLabel}>{label}</Text>
        <View style={styles.divider} />
      </View>
      <View style={styles.buttons}>
        {googleAvailable ? (
          <ProviderButton
            name="Google"
            mark="G"
            markColor="#4285F4"
            loading={pending === 'google'}
            disabled={locked}
            onPress={() => start('google')}
          />
        ) : null}
        {zaloAvailable ? (
          <ProviderButton
            name="Zalo"
            mark="Z"
            markColor="#0068FF"
            loading={pending === 'zalo'}
            disabled={locked}
            onPress={() => start('zalo')}
          />
        ) : null}
      </View>
    </View>
  );
}

function ProviderButton({
  name,
  mark,
  markColor,
  loading,
  disabled,
  onPress,
}: {
  name: string;
  mark: string;
  markColor: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Đăng nhập bằng ${name}`}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, (pressed || (disabled && !loading)) && styles.dimmed]}>
      {loading ? (
        <ActivityIndicator size="small" color={markColor} />
      ) : (
        <Text style={[styles.mark, { color: markColor }]}>{mark}</Text>
      )}
      <Text style={styles.name}>{name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  divider: { height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: Palette.parchment400 },
  dividerLabel: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 9,
    letterSpacing: 1,
    color: Palette.charcoalMuted,
  },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  button: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.parchment400,
    backgroundColor: '#FFFFFF',
  },
  dimmed: { opacity: 0.6 },
  mark: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 },
  name: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: Palette.charcoal },
});
