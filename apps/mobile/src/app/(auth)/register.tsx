import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-context';
import { MAX_DISPLAY_NAME_LENGTH, MIN_PASSWORD_LENGTH, validateEmail, validatePassword } from '@/auth/validation';
import { KeyboardAvoider } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { TextField } from '@/components/ui/text-field';
import { Colors, Palette, Radius, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';

export default function RegisterScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { register } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [emailTaken, setEmailTaken] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    const next = { email: validateEmail(email), password: validatePassword(password) };
    setErrors(next);
    setFormError(null);
    setEmailTaken(false);
    if (next.email || next.password) return;

    setSubmitting(true);
    try {
      const result = await register({
        email: email.trim(),
        password,
        ...(displayName.trim() && { displayName: displayName.trim() }),
      });
      router.push({ pathname: '/verify', params: { email: result.verificationEmailSentTo } });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setErrors({ email: error.message });
        setEmailTaken(true);
      } else {
        setFormError(error instanceof ApiError ? error.message : 'Không tạo được tài khoản. Thử lại sau ít phút.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const passwordStrength = getPasswordStrength(password);

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
              <Text style={styles.journeyBadgeText}>HÀNH TRÌNH VIỆT NAM · TẬP 01</Text>
            </View>
          </View>
          <View style={styles.heroBrand}>
            <Text style={styles.brandEyebrow}>MỞ TRANG SỔ MỚI</Text>
            <View style={styles.brandTitleRow}>
              <Text style={styles.brandTitle}>Rong</Text>
              <Text style={styles.brandSlogan}>Rong Thong Dong</Text>
            </View>
          </View>
          <View style={styles.compassBadge} pointerEvents="none">
            <Icon name="route" size={16} color={Palette.turmeric100} />
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={styles.title} accessibilityRole="header">Tạo tài khoản</Text>
          <Text style={styles.subtitle}>Bắt đầu gom những điểm đến bạn muốn rong chơi.</Text>
        </View>

        <View style={styles.form}>
          <TextField
            label="TÊN HIỂN THỊ · KHÔNG BẮT BUỘC"
            labelStyle={styles.fieldLabel}
            leadingIcon="person"
            hint="Bạn bè trong chuyến đi chung sẽ thấy tên này."
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            autoComplete="name"
            textContentType="nickname"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            submitBehavior="submit"
          />
          <TextField
            ref={emailRef}
            label="ĐỊA CHỈ EMAIL"
            labelStyle={styles.fieldLabel}
            leadingIcon="mail"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (errors.email) setErrors((current) => ({ ...current, email: null }));
              setEmailTaken(false);
            }}
            error={errors.email}
            placeholder="ban@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            submitBehavior="submit"
          />
          {emailTaken ? (
            <Button
              label="Đăng nhập bằng email này"
              variant="plain"
              size="sm"
              style={styles.inlineAction}
              onPress={() => router.dismissTo({ pathname: '/login', params: { email: email.trim() } })}
            />
          ) : null}
          <View style={styles.passwordField}>
            <TextField
              ref={passwordRef}
              label="MẬT KHẨU"
              labelStyle={styles.fieldLabel}
              leadingIcon="lock"
              hint={`Ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`}
              password
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (errors.password) setErrors((current) => ({ ...current, password: null }));
              }}
              error={errors.password}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <View style={styles.strengthRow} accessibilityLabel={`Độ mạnh mật khẩu: ${passwordStrength.label}`}>
              <View style={styles.strengthSegments}>
                {[0, 1, 2, 3].map((index) => (
                  <View
                    key={index}
                    style={[
                      styles.strengthSegment,
                      index < passwordStrength.level && { backgroundColor: passwordStrength.color },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.strengthLabel, passwordStrength.level > 0 && { color: passwordStrength.color }]}>
                {passwordStrength.label}
              </Text>
            </View>
          </View>
          {formError ? <Notice tone="danger">{formError}</Notice> : null}
          <Text style={styles.legalCopy}>
            Khi tiếp tục, bạn đồng ý với <Text style={styles.legalEmphasis}>Điều khoản sử dụng</Text> và{' '}
            <Text style={styles.legalEmphasis}>Chính sách quyền riêng tư</Text> của Rong.
          </Text>
          <Button
            accessibilityLabel="Tạo tài khoản và bắt đầu"
            label={submitting ? 'Đang tạo tài khoản…' : 'Tạo tài khoản & đi thôi  ›'}
            size="lg"
            loading={submitting}
            onPress={submit}
            style={styles.submitButton}
          />
        </View>

        <View style={styles.oauthSection}>
          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerLabel}>HOẶC ĐĂNG KÝ VỚI</Text>
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
            Đã có tài khoản?{' '}
            <Link
              href={{ pathname: '/login', params: email ? { email: email.trim() } : {} }}
              dismissTo
              style={styles.link}>
              Đăng nhập ngay
            </Link>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoider>
  );
}

function getPasswordStrength(password: string) {
  if (!password) return { level: 0, label: 'Chưa nhập mật khẩu', color: Palette.charcoalMuted };
  let level = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) level += 1;
  if (password.length >= 12) level += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) level += 1;
  if (/\d|[^a-zA-Z\d]/.test(password)) level += 1;
  const labels = ['Còn yếu', 'Còn yếu', 'Tạm ổn', 'Khá tốt', 'Mạnh'];
  const colors = [Palette.charcoalMuted, Palette.terracotta700, Palette.terracotta700, Palette.turmeric700, Palette.forest700];
  return { level, label: labels[level], color: colors[level] };
}

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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Palette.parchment50 },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: Spacing.four, gap: Spacing.four },
  hero: {
    height: 164,
    padding: Spacing.five,
    borderRadius: Radius.lg,
    backgroundColor: Palette.forest900,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  mapRingOuter: {
    position: 'absolute', right: -40, top: 8, width: 182, height: 182,
    borderRadius: 91, borderWidth: 1, borderColor: 'rgba(187,238,211,0.12)',
  },
  mapRingInner: {
    position: 'absolute', right: 2, top: 50, width: 96, height: 96,
    borderRadius: 48, borderWidth: 1, borderColor: 'rgba(217,155,38,0.22)',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
  },
  journeyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.one,
    paddingHorizontal: Spacing.two + 2, paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill, backgroundColor: 'rgba(217,155,38,0.18)',
    borderWidth: 1, borderColor: 'rgba(217,155,38,0.3)',
  },
  journeyBadgeText: {
    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 8, letterSpacing: 0.5, color: Palette.turmeric100,
  },
  heroBrand: { gap: 2, zIndex: 1 },
  brandEyebrow: {
    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, letterSpacing: 1.8, color: Palette.forest200,
  },
  brandTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.three },
  brandTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 36, lineHeight: 44, color: Palette.onPine },
  brandSlogan: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: Palette.turmeric100 },
  compassBadge: {
    position: 'absolute', right: Spacing.three, bottom: Spacing.one, width: 38, height: 38,
    borderRadius: Radius.pill, backgroundColor: Palette.terracotta500, borderWidth: 3,
    borderColor: Palette.forest900, alignItems: 'center', justifyContent: 'center',
  },
  intro: { gap: Spacing.one, paddingTop: Spacing.two },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 25, lineHeight: 33, color: Palette.forest900 },
  subtitle: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, lineHeight: 19, color: Colors.light.textSecondary },
  form: { gap: Spacing.four },
  fieldLabel: {
    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, letterSpacing: 1.1, color: Palette.charcoalMuted,
  },
  passwordField: { gap: Spacing.two },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  strengthSegments: { flex: 1, flexDirection: 'row', gap: Spacing.one },
  strengthSegment: { height: 3, flex: 1, borderRadius: Radius.pill, backgroundColor: Palette.parchment300 },
  strengthLabel: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: Palette.charcoalMuted },
  inlineAction: { alignSelf: 'flex-start', marginTop: -Spacing.three, paddingHorizontal: 0 },
  legalCopy: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, lineHeight: 16, color: Colors.light.textSecondary },
  legalEmphasis: { fontFamily: 'PlusJakartaSans_600SemiBold', color: Palette.forest700 },
  submitButton: { marginTop: -Spacing.one },
  oauthSection: { gap: Spacing.three },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  divider: { height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: Palette.parchment400 },
  dividerLabel: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, letterSpacing: 1, color: Palette.charcoalMuted },
  oauthButtons: { flexDirection: 'row', gap: Spacing.two },
  oauthButton: {
    minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.two, borderRadius: Radius.pill, borderWidth: 1, borderColor: Palette.parchment400,
    backgroundColor: '#FFFFFF',
  },
  oauthMark: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 },
  oauthLabel: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: Palette.charcoal },
  footer: { marginTop: 'auto', alignItems: 'center', paddingTop: Spacing.two },
  footerText: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, lineHeight: 20, color: Colors.light.textSecondary },
  link: { fontFamily: 'PlusJakartaSans_600SemiBold', color: Palette.terracotta700 },
  pressed: { opacity: 0.78 },
});
