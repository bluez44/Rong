/**
 * Hợp đồng xác thực giữa backend, app di động và web — PRD F11.
 */
export interface UserProfile {
  id: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  /** Số giây còn lại của accessToken. */
  expiresIn: number;
  user: UserProfile;
}

export interface RegisterResult {
  user: UserProfile;
  /** Mã xác minh 6 chữ số đã được gửi tới email này; nhập mã để kích hoạt tài khoản. */
  verificationEmailSentTo: string;
}
