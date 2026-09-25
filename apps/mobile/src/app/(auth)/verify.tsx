import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { AuthScreen } from '@/components/auth-screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { Notice } from '@/components/ui/notice';
import { Spacing, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';

const CODE_LENGTH = 6;
/** Khớp RESEND_COOLDOWN_MS của backend: gửi sớm hơn thì backend im lặng bỏ qua. */
const RESEND_COOLDOWN_SECONDS = 60;
/** Khớp EMAIL_VERIFICATION_TTL_MINUTES mặc định của backend. */
const CODE_TTL_MINUTES = 15;

export default function VerifyScreen() {
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const router = useRouter();
  const { verifyEmail, resendVerification } = useAuth();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit(value: string) {
    setSubmitting(true);
    setError(null);
    try {
      await verifyEmail(email, value);
      // Thành công thì đã đăng nhập; Stack.Protected tự chuyển sang app.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không xác minh được mã. Thử lại sau ít phút.');
    } finally {
      setSubmitting(false);
    }
  }

  function onChange(value: string) {
    setCode(value);
    if (error) setError(null);
    if (value.length === CODE_LENGTH && !submitting) submit(value);
  }

  async function resend() {
    setError(null);
    setResent(false);
    try {
      await resendVerification(email);
      setCode('');
      setResent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không gửi lại được mã. Thử lại sau ít phút.');
    }
  }

  return (
    <AuthScreen
      title="Nhập mã xác minh"
      subtitle={
        <>
          Mã 6 số đã được gửi tới <ThemedText type="body" style={styles.email}>{email}</ThemedText>. Mã có hiệu lực trong {CODE_TTL_MINUTES} phút.
        </>
      }
      footer={<Button label="Đổi email" variant="plain" onPress={() => router.back()} />}>
      <CodeInput value={code} onChange={onChange} length={CODE_LENGTH} error={!!error} editable={!submitting} autoFocus />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {resent && !error ? (
        <Notice tone="info" title="Đã gửi lại mã">
          Mã cũ không dùng được nữa. Kiểm tra cả thư mục Spam hoặc Quảng cáo.
        </Notice>
      ) : null}
      <Button
        label={submitting ? 'Đang xác minh…' : 'Xác minh'}
        size="lg"
        loading={submitting}
        disabled={code.length < CODE_LENGTH}
        onPress={() => submit(code)}
      />
      <View style={styles.resendRow}>
        {cooldown > 0 ? (
          <ThemedText type="callout" themeColor="textSecondary">
            Chưa nhận được mã? Gửi lại sau {cooldown} giây
          </ThemedText>
        ) : (
          <Button label="Gửi lại mã" variant="plain" onPress={resend} />
        )}
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  email: { fontFamily: Type.headline.fontFamily },
  resendRow: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingTop: Spacing.one },
});
