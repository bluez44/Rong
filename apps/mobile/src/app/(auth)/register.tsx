import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { MAX_DISPLAY_NAME_LENGTH, MIN_PASSWORD_LENGTH, validateEmail, validatePassword } from '@/auth/validation';
import { AuthScreen } from '@/components/auth-screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { TextField } from '@/components/ui/text-field';
import { Colors, Spacing, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';

export default function RegisterScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
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

  return (
    <AuthScreen
      title="Tạo tài khoản"
      subtitle="Chúng tôi sẽ gửi mã 6 số tới email để kích hoạt tài khoản."
      footer={
        <ThemedText type="callout" themeColor="textSecondary">
          Đã có tài khoản?{' '}
          <Link href={{ pathname: '/login', params: email ? { email: email.trim() } : {} }} dismissTo style={styles.link}>
            Đăng nhập
          </Link>
        </ThemedText>
      }>
      <TextField
        label="Tên hiển thị"
        hint="Không bắt buộc. Bạn bè trong nhóm sẽ thấy tên này."
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
        label="Email"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (errors.email) setErrors((e) => ({ ...e, email: null }));
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
      <TextField
        ref={passwordRef}
        label="Mật khẩu"
        hint={`Ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`}
        password
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          if (errors.password) setErrors((e) => ({ ...e, password: null }));
        }}
        error={errors.password}
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <Button label={submitting ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'} size="lg" loading={submitting} onPress={submit} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  link: { ...Type.callout, fontFamily: Type.headline.fontFamily, color: Colors.light.primary },
  inlineAction: { alignSelf: 'flex-start', marginTop: -Spacing.three, paddingHorizontal: 0 },
});
