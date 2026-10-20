# Đăng nhập bằng Google và Zalo — thiết kế

Ngày: 2026-10-21. PRD: F11 (Tài khoản & onboarding), §4.2 (đăng nhập Google / Apple / số điện thoại).

## Mục tiêu

Người dùng đăng nhập hoặc đăng ký Rong bằng một chạm qua Google hoặc Zalo, không cần mật khẩu hay mã xác minh email, và nhận cùng loại phiên như đăng nhập bằng mật khẩu (access token 15 phút + refresh token 60 ngày).

**Thành công khi:**
- Bấm "Google" hoặc "Zalo" trên màn đăng nhập/đăng ký của app Android → vào thẳng trang chủ.
- Người đã có tài khoản email + mật khẩu, đăng nhập Google bằng cùng email → vào đúng tài khoản cũ, thấy đủ lịch trình.
- Thiếu cấu hình (chưa có Client ID / App ID) thì app và backend vẫn chạy; nút tương ứng không hiện.

## Quyết định đã chốt (2026-10-20/21)

| Vấn đề | Quyết định |
| --- | --- |
| Nhà cung cấp | Google và Zalo. Apple bỏ lần này (app chưa có bản iOS). |
| Email Google trùng tài khoản email có sẵn | **Tự gộp** vào tài khoản cũ, chỉ khi Google báo `email_verified = true`. |
| Cách đăng nhập trên mobile | **SDK native cho cả hai**: `@react-native-google-signin/google-signin`, `react-native-zalo-kit`. |
| Xác minh Zalo | Backend gọi Graph API với `appsecret_proof`; nếu bước kiểm tra ở §7.B cho thấy Zalo không từ chối proof sai thì tắt Zalo và chuyển sang OAuth qua trình duyệt (PKCE, backend tự đổi mã). |
| Test mobile | Thêm **Jest + `jest-expo` + React Native Testing Library**. |
| Tài khoản nhà cung cấp | Chưa có; spec kèm hướng dẫn tạo (§7). Code đọc ID/secret từ env. |

## Ngoài phạm vi

Sign in with Apple; liên kết / hủy liên kết nhà cung cấp trong trang Tài khoản; đăng nhập bằng số điện thoại; lưu ảnh đại diện; e2e mobile tự động (Maestro).

---

## 1. Dữ liệu

Migration mới `AddZaloAuthProvider`:

```sql
ALTER TYPE "auth_provider" ADD VALUE IF NOT EXISTS 'zalo';
```

(Giá trị enum mới không dùng được trong cùng transaction vừa thêm nó; migration đặt `transaction = false` cho chắc. `down` để trống kèm comment: Postgres không xóa được giá trị enum.)

Mảng `AUTH_PROVIDERS` (kiểu `AuthProvider`) trong `modules/auth/entities/auth-identity.entity.ts` thêm `'zalo'`.

Bảng `auth_identities` không đổi. Mỗi danh tính ngoài:

| Cột | Google | Zalo |
| --- | --- | --- |
| `provider` | `google` | `zalo` |
| `provider_account_id` | `sub` của ID token | `id` từ Graph API (id riêng theo app) |
| `email` | email trong token (chữ thường) | `null` |
| `email_verified_at` | `now()` nếu `email_verified` | `null` |
| `password_hash` | `null` | `null` |

`users.display_name`: lấy `name` của nhà cung cấp **chỉ khi tạo user mới**; không ghi đè về sau.

`UserProfile.email` đã cho phép `null` (`toProfile` chọn email của danh tính đầu tiên có email), nên người dùng chỉ có Zalo không cần đổi kiểu.

## 2. Backend

### 2.1 Endpoint

Cả hai `@Public()`, trả `AuthTokens` (giống `POST /auth/login`), DTO có `class-validator`:

| Route | Body | Ghi chú |
| --- | --- | --- |
| `POST /api/auth/google` | `{ idToken: string }` | `@IsString() @MaxLength(4096)` |
| `POST /api/auth/zalo` | `{ accessToken: string }` | `@IsString() @MaxLength(2048)` |

Kiểu chung thêm vào `packages/shared-types/src/auth.ts`: `GoogleLoginRequest`, `ZaloLoginRequest`.

### 2.2 Xác minh danh tính — `modules/auth/external/`

Mỗi nhà cung cấp một class, trả cùng một kiểu:

```ts
interface ExternalIdentity {
  provider: 'google' | 'zalo';
  accountId: string;
  email: string | null;        // đã chuyển chữ thường
  emailVerified: boolean;
  displayName: string | null;
}
```

**`GoogleIdTokenVerifier.verify(idToken)`**
- Thư viện `jose` (thêm vào backend): `createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))` (tự cache khóa), `jwtVerify` với `issuer: ['https://accounts.google.com', 'accounts.google.com']`, `audience: config.google.clientIds`, `algorithms: ['RS256']`.
- `sub` bắt buộc. `email_verified` có thể là boolean hoặc chuỗi `"true"`.
- Chữ ký/hạn/aud sai → `EXTERNAL_TOKEN_INVALID`. Không tải được JWKS → `PROVIDER_UNAVAILABLE`.
- Đây là Google Identity, không phải Google Maps Platform; không vướng PRD §7.4 hay hạn chế lãnh thổ của GMP.

**`ZaloProfileClient.fetch(accessToken)`**
- `GET https://graph.zalo.me/v2.0/me?fields=id,name` với header `access_token: <token>` và `appsecret_proof: <hex HMAC-SHA256(token, ZALO_APP_SECRET)>`, timeout 5 s.
- Zalo trả lỗi trong JSON (`error != 0`) kể cả khi HTTP 200: lỗi token/proof → `EXTERNAL_TOKEN_INVALID`; HTTP 5xx, timeout, lỗi mạng → `PROVIDER_UNAVAILABLE`.
- `emailVerified: false`, `email: null`.

Thiếu cấu hình của nhà cung cấp (§2.5) → `PROVIDER_NOT_CONFIGURED` trước khi gọi ra ngoài.

### 2.3 Tìm / gộp / tạo — `ExternalLoginService.login(identity)`

Chạy trong một transaction:

1. `SELECT … FROM auth_identities WHERE provider = $1 AND provider_account_id = $2` → có thì lấy user đó.
2. Không có, **và** `provider = 'google'` **và** `emailVerified` **và** có danh tính khác với `lower(email) = $email`:
   - thêm danh tính Google trỏ vào user của danh tính đó;
   - danh tính trùng email nào có `email_verified_at IS NULL` thì đặt `now()` (Google đã xác minh email).
   - Nhiều user cùng email (không nên xảy ra): chọn user tạo sớm nhất, ghi log cảnh báo.
3. Còn lại: tạo `users` (display_name = tên nhà cung cấp) và danh tính mới.

Hai yêu cầu đăng nhập lần đầu cùng lúc: bên `INSERT` thua gặp vi phạm `uq_identity_provider_account` (23505) → rollback, đọc lại theo bước 1 và dùng user đó. Không trả 500.

Sau đó gọi `issueTokens(user, identities)` hiện có (đưa thành method dùng chung giữa `AuthService` và `ExternalLoginService`, không nhân bản).

### 2.4 Lỗi

Theo quy ước `{ code, message }` tiếng Việt:

| HTTP | `code` | Khi nào |
| --- | --- | --- |
| 401 | `EXTERNAL_TOKEN_INVALID` | Token sai, hết hạn, không cấp cho Rong, proof sai |
| 503 | `PROVIDER_NOT_CONFIGURED` | Thiếu env của nhà cung cấp |
| 502 | `PROVIDER_UNAVAILABLE` | Google/Zalo lỗi hoặc quá 5 s |

Không ghi token vào log.

### 2.5 Cấu hình

`configuration.ts` thêm `oauth`, tất cả không bắt buộc:

```ts
export interface OAuthConfig {
  /** Client ID được chấp nhận làm `aud` của ID token Google (Web client). Rỗng = tắt Google. */
  googleClientIds: string[];
  /** Zalo for Developers. Thiếu một trong hai = tắt Zalo. */
  zaloAppId: string | null;
  zaloAppSecret: string | null;
}
```

Env: `GOOGLE_OAUTH_CLIENT_IDS` (phân tách bằng dấu phẩy), `ZALO_APP_ID`, `ZALO_APP_SECRET`. Thêm vào `.env.example` kèm comment trỏ tới spec này.

### 2.6 Tài liệu

`src/modules/README.md` (mục auth) và `CLAUDE.md` ("Login design"): thêm hai endpoint, quy tắc gộp, env.

## 3. Mobile

### 3.1 Phụ thuộc và cấu hình native

- `@react-native-google-signin/google-signin` (bản miễn phí) và `react-native-zalo-kit` (≥ 6.0.0), cài bằng `npx expo install`.
- `app.config.ts` → `plugins`:
  - `'@react-native-google-signin/google-signin'`
  - `['react-native-zalo-kit', { appId: process.env.ZALO_APP_ID }]` — chỉ thêm khi `ZALO_APP_ID` có giá trị.
- Env: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (truyền vào `GoogleSignin.configure({ webClientId })` để `idToken` có `aud` là Web client), `ZALO_APP_ID` (đọc lúc build và lộ ra JS qua `extra`). Thêm vào `apps/mobile/.env.example`.
- Cần build lại bản native (prebuild); Expo Go không chạy được. Không cập nhật OTA được cho thay đổi này.
- Nếu `react-native-zalo-kit` cần ProGuard rule cho bản release, thêm qua plugin hoặc `expo-build-properties` (kiểm tra README của thư viện khi cài).

### 3.2 `lib/oauth.ts`

Gói SDK, trả kết quả có kiểu để màn hình không phải biết SDK:

```ts
type OAuthResult =
  | { kind: 'token'; token: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; message: string };   // ví dụ không có Play Services

export const googleAvailable: boolean;  // có EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
export const zaloAvailable: boolean;    // có ZALO_APP_ID
export function signInWithGoogle(): Promise<OAuthResult>;   // trả idToken
export function signInWithZalo(): Promise<OAuthResult>;     // trả accessToken, AUTH_VIA_APP_OR_WEB
export function signOutProviders(): Promise<void>;          // nuốt lỗi
```

- Google: `GoogleSignin.hasPlayServices()` → `signIn()`; mã lỗi `SIGN_IN_CANCELLED` → `cancelled`; `PLAY_SERVICES_NOT_AVAILABLE` → `unavailable` ("Máy này không hỗ trợ đăng nhập Google.").
- Zalo: `login(Constants.AUTH_VIA_APP_OR_WEB)`; người dùng hủy → `cancelled` (mã lỗi theo thư viện, xác định khi cài).

### 3.3 `auth-context`

Thêm `loginWithGoogle()` và `loginWithZalo()` cạnh `login`:

```
const r = await signInWithGoogle();
if (r.kind !== 'token') return r;                     // màn hình xử lý cancelled/unavailable
await startSession(await apiFetch<AuthTokens>('/auth/google', { method: 'POST', body: { idToken: r.token } }));
```

`startSession` hiện có lo lưu phiên, refresh token và chuyển màn. `ApiError` từ backend được ném lên như `login`.

`signOut` gọi thêm `signOutProviders()` (không chặn, không báo lỗi) để lần sau người dùng được chọn lại tài khoản.

### 3.4 Màn login và register

- Thay `OAuthPlaceholder` bằng component dùng chung `OAuthButtons` (Google, Zalo); bỏ nút Apple.
- Chỉ hiện nút của nhà cung cấp đã cấu hình; không nhà cung cấp nào → ẩn cả khối "hoặc".
- Đang đăng nhập: nút được bấm hiện `ActivityIndicator`, cả hai nút và form bị khóa.
- `cancelled` → không báo gì. `unavailable` và `ApiError` → hiện `message` bằng `Notice` như lỗi mật khẩu sai hiện nay.
- Tuân `apps/mobile/CLAUDE.md` (màn đã bọc sẵn; không thêm `KeyboardAvoidingView`).

### 3.5 Test (Jest)

Thiết lập một lần:
- `jest-expo`, `jest`, `@testing-library/react-native`, `@types/jest` (devDependencies, phiên bản theo `npx expo install`).
- `jest.config.js` với `preset: 'jest-expo'`; script `"test": "jest"` để `pnpm test` ở gốc (turbo) chạy luôn mobile.

Test:
- `lib/oauth.test.ts` (mock hai SDK bằng `jest.mock`): token, hủy, không có Play Services, thiếu cấu hình.
- `auth/auth-context.test.tsx`: `loginWithGoogle` gọi `/auth/google` với đúng body rồi lưu phiên; hủy thì không gọi API; backend 401 thì ném `ApiError`.
- `lib/share-link.test.ts`: `resolveShareToken` — editor gọi `PUT`, viewer gọi `GET`, viewer không có link → `null`.

## 4. Kiểm thử backend

- Unit (`vitest`):
  - `ExternalLoginService`: ba nhánh (đã có danh tính / gộp theo email / tạo mới); không gộp khi `emailVerified = false`; không gộp với Zalo; đánh dấu xác minh danh tính mật khẩu khi gộp.
  - `GoogleIdTokenVerifier`: ký token bằng khóa RSA tạo trong test, JWKS giả (`createLocalJWKSet`); sai `aud`, sai `iss`, hết hạn, `email_verified` dạng chuỗi.
  - `ZaloProfileClient`: header `appsecret_proof` đúng HMAC; `error != 0` → `EXTERNAL_TOKEN_INVALID`; timeout → `PROVIDER_UNAVAILABLE`; thiếu cấu hình → `PROVIDER_NOT_CONFIGURED`.
- e2e (`test/social-login.e2e-spec.ts`, verifier và client được `overrideProvider` bằng bản giả):
  - Google lần đầu tạo user, lần hai vào lại cùng user.
  - Đăng ký email + mật khẩu (chưa xác minh) rồi Google cùng email → cùng user, `emailVerified: true`, sau đó đăng nhập mật khẩu được.
  - Zalo tạo user không có email; `GET /users/me` trả `email: null`.
  - Hai lần Google đồng thời với cùng `sub` → cùng user, không 500.
  - Token sai → 401 `EXTERNAL_TOKEN_INVALID`; thiếu cấu hình → 503 `PROVIDER_NOT_CONFIGURED`.
  - Xóa tài khoản → danh tính Google/Zalo bị xóa theo (FK cascade), đăng nhập lại tạo user mới.

## 5. Kiểm tra tay trên Android (sau khi có ID ở §7)

1. Google lần đầu → tài khoản mới, tên lấy từ Google.
2. Google với email đã đăng ký bằng mật khẩu → đúng tài khoản cũ, đủ lịch trình.
3. Zalo khi máy có app Zalo (mở app Zalo) và khi không có (mở web).
4. Hủy giữa chừng ở cả hai → quay lại màn đăng nhập, không có thông báo.
5. Đăng xuất rồi bấm Google → được chọn lại tài khoản.

## 6. Thứ tự triển khai

1. Merge và deploy backend (chạy migration thêm `'zalo'`). Chưa có env thì hai endpoint trả 503, không ảnh hưởng gì khác.
2. Tạo tài khoản nhà cung cấp theo §7; đặt trên Render: `GOOGLE_OAUTH_CLIENT_IDS`, `ZALO_APP_ID`, `ZALO_APP_SECRET`.
3. Chạy bước kiểm tra `appsecret_proof` (§7.B.5).
4. Đặt env EAS (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `ZALO_APP_ID`) cho các profile `release` và `production`; build lại APK.
5. Kiểm tra tay theo §5.

## 7. Hướng dẫn tạo tài khoản nhà cung cấp

### A. Google Cloud Console (console.cloud.google.com)

1. **Tạo project** "Rong" (hoặc dùng project có sẵn).
2. **APIs & Services → OAuth consent screen** (giao diện mới: *Google Auth Platform → Branding / Audience*):
   - User type: **External**.
   - Tên app "Rong", email hỗ trợ, logo, link chính sách quyền riêng tư.
   - Scope: chỉ `openid`, `email`, `profile` (scope cơ bản, không cần Google thẩm định).
   - **Publishing status → In production.** Để *Testing* thì chỉ tài khoản được thêm tay (tối đa 100) đăng nhập được.
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Tên "Rong backend". Không cần Authorized redirect URI.
   - Client ID này dùng cho cả `GOOGLE_OAUTH_CLIENT_IDS` (backend) và `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (mobile). Không cần Client secret.
4. **Credentials → OAuth client ID → Android**, mỗi chứng chỉ ký một client:
   - Package name: `vn.rong.app`.
   - SHA-1:
     - **Release / APK GitHub** (ký bằng keystore trên EAS): `eas credentials -p android` → chọn profile → xem *SHA1 Fingerprint*.
     - **Debug** (build local): `keytool -list -v -keystore apps/mobile/android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android`.
     - **Google Play** (nếu phát hành qua Play): Play Console → *Test and release → App integrity → App signing key certificate* → SHA-1.
   - Client Android không cần điền vào đâu; Google dùng package + SHA-1 để cho phép app gọi Sign-In.
5. Lưu ý: `ANDROID_APP_LINK_SHA256` hiện có là SHA-**256** của cùng chứng chỉ; Google Sign-In cần SHA-**1**.

### B. Zalo for Developers (developers.zalo.me)

1. Đăng nhập bằng tài khoản Zalo → **Tạo ứng dụng mới**: tên "Rong", danh mục Du lịch, mô tả, logo.
2. Trang ứng dụng → **Thông tin / Cài đặt**: ghi lại **App ID** và **Secret Key** (`ZALO_APP_ID`, `ZALO_APP_SECRET`). Secret Key chỉ đặt trên backend, không đưa vào app.
3. **Sản phẩm → Đăng nhập (Social API / Login with Zalo)** → kích hoạt, rồi khai báo nền tảng:
   - **Android:** package `vn.rong.app` và **key hash** của từng chứng chỉ ký. Lấy bằng `getApplicationHashKey()` của `react-native-zalo-kit` (log ra trong bản debug), hoặc `keytool -exportcert -alias <alias> -keystore <keystore> | openssl sha1 -binary | openssl base64`.
   - **Web / Callback URL** (dùng khi máy không có app Zalo): theo hướng dẫn của `react-native-zalo-kit`.
4. **Kích hoạt ứng dụng** (chuyển trạng thái khỏi chế độ phát triển). **Cần kiểm tra trên trang Zalo:** khi chưa kích hoạt, có giới hạn chỉ quản trị viên / người thử nghiệm đăng nhập được không, và Zalo có yêu cầu xác thực tài khoản/doanh nghiệp để kích hoạt không. Ghi kết quả vào `src/modules/README.md`.
5. **Kiểm tra `appsecret_proof`** (bắt buộc trước khi bật Zalo cho người dùng). Lấy một access token thật (đăng nhập thử trên bản debug, log token ở máy dev, không commit), rồi:
   ```bash
   # proof đúng → trả id, name
   curl -H "access_token: $T" -H "appsecret_proof: $(printf %s "$T" | openssl dgst -sha256 -hmac "$ZALO_APP_SECRET" -hex | awk '{print $2}')" \
     "https://graph.zalo.me/v2.0/me?fields=id,name"
   # proof sai → phải trả lỗi (error != 0)
   curl -H "access_token: $T" -H "appsecret_proof: deadbeef" "https://graph.zalo.me/v2.0/me?fields=id,name"
   ```
   Nếu lệnh thứ hai vẫn trả id: bỏ trống `ZALO_APP_ID`/`ZALO_APP_SECRET` trên Render (Zalo tắt), và lập spec phụ chuyển Zalo sang OAuth qua trình duyệt với PKCE (backend đổi mã bằng Secret Key). Ngay cả khi đó, id Zalo là id riêng theo app nên token của app khác không chiếm được tài khoản Rong có sẵn.

## 8. Rủi ro

- **`react-native-zalo-kit` do một cá nhân duy trì.** Nếu thư viện ngừng cập nhật theo Expo/RN mới, phương án thay là OAuth qua trình duyệt (§7.B.5).
- **Gộp theo email** tin vào xác minh email của Google. Chỉ gộp khi `email_verified = true`; không bao giờ gộp với Zalo.
- **Người dùng chỉ có Zalo không có email**: không nhận được email nào từ Rong (hiện chỉ có email xác minh). Nếu sau này cần email (thông báo, khôi phục), phải bổ sung bước xin email.
