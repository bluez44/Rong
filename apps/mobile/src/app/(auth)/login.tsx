import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-context';
import { validateEmail } from '@/auth/validation';
import { KeyboardAvoider } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { TextField } from '@/components/ui/text-field';
import { Colors, Palette, Radius, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { login, resendVerification, sessionExpired } = useAuth();

  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    const invalid = validateEmail(email);
    setEmailError(invalid);
    setFormError(null);
    if (invalid || !password) {
      if (!invalid) setFormError('Nhập mật khẩu để đăng nhập.');
      return;
    }

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // Đăng nhập xong, Stack.Protected ở layout gốc tự chuyển sang app.
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED') {
        // Gửi mã mới rồi chuyển sang màn nhập mã; lỗi gửi thì người dùng vẫn bấm "Gửi lại mã" ở đó.
        await resendVerification(email.trim()).catch(() => undefined);
        router.push({ pathname: '/verify', params: { email: email.trim() } });
      } else {
        setFormError(error instanceof ApiError ? error.message : 'Không đăng nhập được. Thử lại sau ít phút.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoider style={styles.screen}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.two, paddingBottom: insets.bottom + Spacing.four },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="never">
        <View style={styles.hero}>
          <View style={styles.mapRingOuter} pointerEvents="none" />
          <View style={styles.mapRingInner} pointerEvents="none" />
          <View style={styles.heroTopRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quay lại"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/onboarding'))}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <Icon name="back" size={18} color={Palette.onPine} />
            </Pressable>
            <View style={styles.journeyBadge}>
              <Icon name="explore" size={12} color={Palette.turmeric100} />
              <Text style={styles.journeyBadgeText}>HÀNH TRÌNH VIỆT NAM</Text>
            </View>
          </View>

          <View style={styles.heroBrand}>
            <Text style={styles.brandEyebrow}>SỔ TAY ĐỒNG HÀNH</Text>
            <View style={styles.brandTitleRow}>
              <Text style={styles.brandTitle}>Rong</Text>
              <Text style={styles.brandPronunciation}>Rong Thong Dong</Text>
            </View>
          </View>
          <View style={styles.compassBadge} pointerEvents="none">
            <Icon name="route" size={16} color={Palette.turmeric100} />
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={styles.title} accessibilityRole="header">Mừng bạn trở lại</Text>
          <Text style={styles.subtitle}>
            Mở lại những cung đường, quán xá và trang nhật ký đang chờ bạn phía trước.
          </Text>
        </View>

        <View style={styles.form}>
          {sessionExpired && !formError ? (
            <Notice tone="info" title="Phiên đăng nhập đã hết hạn">
              Đăng nhập lại để tiếp tục.
            </Notice>
          ) : null}
          <TextField
            label="ĐỊA CHỈ EMAIL"
            labelStyle={styles.fieldLabel}
            leadingIcon="mail"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (emailError) setEmailError(null);
            }}
            error={emailError}
            placeholder="ban@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            submitBehavior="submit"
          />
          <TextField
            ref={passwordRef}
            label="MẬT KHẨU"
            labelStyle={styles.fieldLabel}
            leadingIcon="lock"
            password
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {formError ? <Notice tone="danger">{formError}</Notice> : null}
          <Button
            accessibilityLabel="Đăng nhập vào hành trình"
            label={submitting ? 'Đang đăng nhập…' : 'Đăng nhập vào hành trình  ›'}
            size="lg"
            loading={submitting}
            onPress={submit}
            style={styles.submitButton}
          />
        </View>

        <View style={styles.oauthSection}>
          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerLabel}>HOẶC TIẾP TỤC VỚI</Text>
            <View style={styles.divider} />
          </View>
          <View style={styles.oauthButtons}>
            <OAuthPlaceholder mark="G" label="Google" markColor="#4285F4" />
            <OAuthPlaceholder mark="A" label="Apple" markColor={Palette.charcoal} />
            <OAuthPlaceholder mark="Z" label="Zalo" markColor="#0068FF" />
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Chưa có tài khoản?{' '}
            <Link
              href={{ pathname: '/register', params: email ? { email: email.trim() } : {} }}
              style={styles.link}>
              Đăng ký ngay
            </Link>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Palette.parchment50 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  hero: {
    height: 164,
    padding: Spacing.five,
    borderRadius: Radius.lg,
    backgroundColor: Palette.forest900,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  mapRingOuter: {
    position: 'absolute',
    right: -40,
    top: 8,
    width: 182,
    height: 182,
    borderRadius: 91,
    borderWidth: 1,
    borderColor: 'rgba(187,238,211,0.12)',
  },
  mapRingInner: {
    position: 'absolute',
    right: 2,
    top: 50,
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    borderColor: 'rgba(217,155,38,0.22)',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  journeyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(217,155,38,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(217,155,38,0.3)',
  },
  journeyBadgeText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 9,
    letterSpacing: 0.7,
    color: Palette.turmeric100,
  },
  heroBrand: { gap: 2, zIndex: 1 },
  brandEyebrow: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.8,
    color: Palette.forest200,
  },
  brandTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  brandTitle: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 36,
    lineHeight: 44,
    color: Palette.onPine,
  },
  brandPronunciation: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 10,
    color: 'rgba(255,255,255,0.78)',
  },
  compassBadge: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.one,
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    backgroundColor: Palette.terracotta500,
    borderWidth: 3,
    borderColor: Palette.forest900,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: { gap: Spacing.one, paddingTop: Spacing.two },
  title: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 25,
    lineHeight: 33,
    color: Palette.forest900,
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: Colors.light.textSecondary,
  },
  form: { gap: Spacing.four },
  oauthSection: { gap: Spacing.three },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  divider: { height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: Palette.parchment400 },
  dividerLabel: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 9,
    letterSpacing: 1,
    color: Palette.charcoalMuted,
  },
  oauthButtons: { flexDirection: 'row', gap: Spacing.two },
  oauthButton: {
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
  oauthMark: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 },
  oauthLabel: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 12,
    color: Palette.charcoal,
  },
  fieldLabel: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.1,
    color: Palette.charcoalMuted,
  },
  submitButton: { marginTop: Spacing.one },
  footer: { marginTop: 'auto', alignItems: 'center', paddingTop: Spacing.four },
  footerText: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: Colors.light.textSecondary,
  },
  link: { fontFamily: 'PlusJakartaSans_600SemiBold', color: Palette.terracotta700 },
  pressed: { opacity: 0.78 },
});

function OAuthPlaceholder({ mark, label, markColor }: { mark: string; label: string; markColor: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, sắp có`}
      accessibilityState={{ disabled: true }}
      disabled
      style={styles.oauthButton}>
      <Text style={[styles.oauthMark, { color: markColor }]}>{mark}</Text>
      <Text style={styles.oauthLabel}>{label}</Text>
    </Pressable>
  );
}

