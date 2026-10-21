# Việc cần làm để bật đăng nhập Google/Zalo và link chia sẻ lịch trình

Code của hai tính năng đã xong:
- **Chia sẻ lịch trình bằng link web** (PR #15, đã merge vào `main`).
- **Đăng nhập Google / Zalo** (branch `feat/social-login`).

Muốn chúng chạy thật, cần làm các bước dưới đây. Thiếu biến môi trường nào thì tính năng đó tự tắt, app và backend vẫn chạy bình thường.

Thiết kế chi tiết:
- `docs/superpowers/specs/2026-10-21-google-zalo-login-design.md`
- `docs/superpowers/plans/2026-10-20-itinerary-share-link.md`

---

## Checklist

### Đăng nhập Google / Zalo

- [ ] Merge `feat/social-login` vào `main` và deploy backend. Migration `AddZaloAuthProvider` chạy khi deploy. Nó **đã chạy trên Neon dev** ngày 2026-10-21.
- [ ] Tạo project Google Cloud và các OAuth client ([hướng dẫn A](#a-google-cloud-console)).
- [ ] Tạo ứng dụng Zalo for Developers ([hướng dẫn B](#b-zalo-for-developers)).
- [ ] Đặt env trên Render: `GOOGLE_OAUTH_CLIENT_IDS`, `ZALO_APP_ID`, `ZALO_APP_SECRET` ([bảng env](#biến-môi-trường)).
- [ ] **Kiểm tra `appsecret_proof` của Zalo** trước khi bật Zalo cho người dùng ([B.5](#b5-kiểm-tra-appsecret_proof-bắt-buộc)).
- [ ] Đặt env trên EAS (environment `preview` và `production`): `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `ZALO_APP_ID`.
- [ ] Build lại APK. Có SDK native mới nên **không** cập nhật OTA được.
- [ ] Thử tay trên máy Android thật ([danh sách](#thử-tay-trên-android)).

### Link chia sẻ lịch trình (tính năng trước, còn treo)

- [ ] Đặt `SHARE_LINK_SECRET` trên Render, ≥ 32 ký tự. Nên làm **trước** khi người dùng thật bắt đầu chia sẻ: đổi giá trị này về sau thì mọi link cũ sẽ bị thay bằng link mới ở lần chia sẻ kế tiếp.
- [ ] Deploy `apps/web` (Vercel hoặc Render Web Service) và đặt `RONG_API_URL`.
- [ ] Đặt `EXPO_PUBLIC_WEB_BASE_URL` trên EAS bằng domain web vừa deploy, rồi build lại app.

### Dọn dẹp

- [ ] Merge PR #16: 4 commit mobile của `feat/home-recommendations`, trong đó có bản sửa lỗi lint ở `itinerary-view.tsx:310`.
- [ ] Cài lại sạch `apps/mobile/node_modules`, vì vẫn còn symlink cũ từ 2026-09-25: xóa thư mục rồi chạy `pnpm install` ở gốc repo. Jest đang tạm né lỗi này bằng `moduleNameMapper`.

---

## Biến môi trường

### Render (backend)

| Biến | Giá trị | Bí mật? |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_IDS` | **Web Client ID** của Google, dạng `1234…-abc.apps.googleusercontent.com`. Nhiều ID thì phân cách bằng dấu phẩy | Không |
| `ZALO_APP_ID` | App ID của ứng dụng Zalo | Không |
| `ZALO_APP_SECRET` | Secret Key của ứng dụng Zalo | **Có**, chỉ đặt ở Render |
| `SHARE_LINK_SECRET` | Chuỗi ngẫu nhiên ≥ 32 ký tự: `openssl rand -base64 48` | **Có** |

Đặt trong *Render → service backend → Environment*. Lưu xong Render tự deploy lại. **Không** đặt Android Client ID của Google vào đây.

### EAS (mobile)

Đặt cho cả environment `preview` (profile `release`, APK đăng lên GitHub) và `production` (profile `production`):

| Biến | Giá trị |
| --- | --- |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | **Cùng** Web Client ID với `GOOGLE_OAUTH_CLIENT_IDS` |
| `ZALO_APP_ID` | Cùng App ID với Render. **Không** đưa Secret Key vào app |
| `EXPO_PUBLIC_WEB_BASE_URL` | Domain web `apps/web`, không có `/` ở cuối |
| `EXPO_PUBLIC_API_BASE_URL` | URL backend trên Render (kiểm tra lại là đã có) |

```bash
cd apps/mobile
eas env:create --environment preview --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value "<web-client-id>" --visibility plaintext
eas env:create --environment preview --name ZALO_APP_ID --value "<zalo-app-id>" --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_WEB_BASE_URL --value "https://<domain-web>" --visibility plaintext
# Lặp lại ba lệnh trên với --environment production
```

### Web (`apps/web`)

| Biến | Giá trị |
| --- | --- |
| `RONG_API_URL` | URL backend trên Render, không có `/api` |
| `NEXT_PUBLIC_APP_DOWNLOAD_URL` | Không bắt buộc; mặc định là trang Releases trên GitHub |

### Chạy thử ở máy local

- `apps/backend/.env`: `GOOGLE_OAUTH_CLIENT_IDS`, `ZALO_APP_ID`, `ZALO_APP_SECRET`.
- `apps/mobile/.env`: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `ZALO_APP_ID`.
- Build bản dev bằng `pnpm --filter @rong/mobile android`. Expo Go **không** chạy được hai SDK đăng nhập.

---

## A. Google Cloud Console

Đăng nhập bằng Google là Google Identity, **không** phải Google Maps Platform, nên không bị hạn chế lãnh thổ như Maps.

### A.1 Tạo project

Mở https://console.cloud.google.com, tạo project **Rong** (hoặc dùng project có sẵn).

### A.2 Màn hình đồng ý (consent screen)

Tìm ở *APIs & Services → OAuth consent screen*. Giao diện mới gọi là *Google Auth Platform*, gồm các mục *Branding / Audience / Data access*.

1. **Audience → User type: External.**
2. **Branding:** tên app "Rong", email hỗ trợ, logo, link chính sách quyền riêng tư và điều khoản.
3. **Data access:** chỉ thêm 3 scope `openid`, `email`, `profile`. Đây là scope cơ bản nên không cần Google thẩm định.
4. **Publishing status → In production.** Nếu để *Testing* thì chỉ những tài khoản được thêm tay (tối đa 100) mới đăng nhập được.

### A.3 Web client (backend và mobile đều dùng)

*Credentials → Create credentials → OAuth client ID*:
- Application type: **Web application**, tên "Rong backend".
- Không cần *Authorized redirect URIs*.
- Copy **Client ID** vào `GOOGLE_OAUTH_CLIENT_IDS` (Render) và `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (EAS). Không cần Client secret.

### A.4 Android client (mỗi chứng chỉ ký một client)

*Credentials → Create credentials → OAuth client ID → Android*:
- Package name: `vn.rong.app`.
- SHA-1 certificate fingerprint lấy như sau:

| Bản build | Cách lấy SHA-1 |
| --- | --- |
| Release / APK trên GitHub (keystore lưu trên EAS) | `cd apps/mobile && eas credentials -p android`, chọn profile `release`, xem *SHA1 Fingerprint* |
| Debug (build ở máy) | `keytool -list -v -keystore apps/mobile/android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android` |
| Google Play (nếu phát hành qua Play) | Play Console → *Test and release → App integrity → App signing key certificate* → SHA-1 |

Client Android **không** cần điền vào env nào: Google dùng package + SHA-1 để cho phép app gọi Sign-In.

`ANDROID_APP_LINK_SHA256` hiện có là SHA-**256** của cùng chứng chỉ. Google Sign-In cần SHA-**1**, đừng nhầm.

### A.5 Lỗi hay gặp

- **`DEVELOPER_ERROR` khi bấm Google trên app:** SHA-1 hoặc package của bản đang chạy chưa có trong client Android, hoặc `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` không phải Web client.
- **Backend trả 401 `EXTERNAL_TOKEN_INVALID`:** `GOOGLE_OAUTH_CLIENT_IDS` trên Render khác với Web Client ID mà app dùng.

---

## B. Zalo for Developers

### B.1 Tạo ứng dụng

Mở https://developers.zalo.me, đăng nhập bằng tài khoản Zalo, chọn **Tạo ứng dụng mới**: tên "Rong", danh mục Du lịch, mô tả, logo.

### B.2 Lấy App ID và Secret Key

Vào trang ứng dụng → *Thông tin / Cài đặt*, ghi lại:
- **App ID** → `ZALO_APP_ID` (Render và EAS).
- **Secret Key** → `ZALO_APP_SECRET` (**chỉ** Render). Không bao giờ đưa vào app hay commit.

### B.3 Bật đăng nhập và khai báo Android

Vào *Sản phẩm → Đăng nhập (Social API / Login with Zalo)* → kích hoạt, rồi khai báo nền tảng:

- **Android:** package `vn.rong.app` và **key hash** của từng chứng chỉ ký (debug, release, Play). Key hash = SHA-1 dạng base64. Lấy bằng một trong hai cách:
  - Gọi `getApplicationHashKey()` của `react-native-zalo-kit` trong bản debug rồi log ra.
  - Chạy:
    ```bash
    keytool -exportcert -alias <alias> -keystore <file.keystore> | openssl sha1 -binary | openssl base64
    ```
- **Web / Callback URL:** dùng khi máy không có app Zalo (thư viện chuyển sang đăng nhập web). Khai báo theo hướng dẫn của `react-native-zalo-kit`.

### B.4 Kích hoạt ứng dụng

Chuyển ứng dụng khỏi chế độ phát triển (*Kích hoạt*). **Cần tự kiểm tra trên trang Zalo** và ghi kết quả vào `apps/backend/src/modules/README.md`:
- Khi chưa kích hoạt, có phải chỉ quản trị viên / người thử nghiệm mới đăng nhập được không?
- Zalo có yêu cầu xác thực tài khoản hay doanh nghiệp để kích hoạt không?

### B.5 Kiểm tra `appsecret_proof` (bắt buộc)

Backend xác minh token Zalo bằng cách gọi Graph API kèm `appsecret_proof` = HMAC-SHA256(token, Secret Key). Phải chắc Zalo **từ chối** proof sai, nếu không thì token cấp cho app khác cũng dùng được.

1. Đăng nhập Zalo thử trên bản debug và lấy access token (log ở máy dev, **không** commit).
2. Chạy:

```bash
T="<access token>"
S="<ZALO_APP_SECRET>"

# Proof đúng → phải trả id và name
curl -s -H "access_token: $T" \
  -H "appsecret_proof: $(printf %s "$T" | openssl dgst -sha256 -hmac "$S" -hex | awk '{print $2}')" \
  "https://graph.zalo.me/v2.0/me?fields=id,name"

# Proof sai → phải trả lỗi (trường error khác 0)
curl -s -H "access_token: $T" -H "appsecret_proof: deadbeef" \
  "https://graph.zalo.me/v2.0/me?fields=id,name"
```

**Nếu lệnh thứ hai vẫn trả id:** bỏ trống `ZALO_APP_ID` / `ZALO_APP_SECRET` trên Render để tắt Zalo, rồi lập spec phụ chuyển Zalo sang OAuth qua trình duyệt với PKCE (backend tự đổi mã bằng Secret Key). Kể cả trong trường hợp đó, id Zalo là id riêng theo app nên token của app khác không chiếm được tài khoản Rong có sẵn.

---

## Thử tay trên Android

Sau khi đặt env và build lại APK:

1. **Google lần đầu** → tạo tài khoản mới, tên lấy từ Google.
2. **Google với email Gmail đã đăng ký và đã xác minh bằng mật khẩu** → vào đúng tài khoản cũ, thấy đủ lịch trình.
3. **Google với email đã đăng ký nhưng chưa xác minh** → tạo tài khoản **mới**, không gộp. Đây là cách chặn chiếm tài khoản.
4. **Zalo** khi máy có app Zalo (mở app Zalo) và khi không có (mở web).
5. **Hủy giữa chừng** ở cả hai → quay lại màn đăng nhập, không có thông báo lỗi.
6. **Đăng xuất, tắt hẳn app, mở lại, bấm Google** → được chọn lại tài khoản, không tự vào tài khoản cũ.
7. **Chia sẻ lịch trình** → link mở được trên trình duyệt; chia sẻ lần hai vẫn ra cùng link.

## Quy tắc gộp tài khoản (để giải thích khi người dùng hỏi)

- Đăng nhập lại cùng tài khoản Google/Zalo → luôn vào đúng tài khoản cũ.
- Google cùng email với một tài khoản **đã xác minh email** → vào tài khoản đó.
- Email của Google chỉ được tin khi là `@gmail.com` hoặc tài khoản Google Workspace.
- Zalo không có email nên **không bao giờ** gộp; người dùng chỉ có Zalo sẽ không nhận được email nào từ Rong.
