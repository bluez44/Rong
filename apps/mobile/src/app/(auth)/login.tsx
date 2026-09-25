import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { validateEmail } from '@/auth/validation';
import { AuthScreen } from '@/components/auth-screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { TextField } from '@/components/ui/text-field';
import { Colors, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
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
    <AuthScreen
      title="Đăng nhập"
      subtitle="Lưu điểm đến và lịch trình của bạn trên mọi thiết bị."
      footer={
        <ThemedText type="callout" themeColor="textSecondary">
          Chưa có tài khoản?{' '}
          <Link href={{ pathname: '/register', params: email ? { email: email.trim() } : {} }} style={styles.link}>
            Đăng ký
          </Link>
        </ThemedText>
      }>
      {sessionExpired && !formError ? (
        <Notice tone="info" title="Phiên đăng nhập đã hết hạn">
          Đăng nhập lại để tiếp tục.
        </Notice>
      ) : null}
      <TextField
        label="Email"
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
        label="Mật khẩu"
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
      <Button label={submitting ? 'Đang đăng nhập…' : 'Đăng nhập'} size="lg" loading={submitting} onPress={submit} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  link: { ...Type.callout, fontFamily: Type.headline.fontFamily, color: Colors.light.primary },
});

