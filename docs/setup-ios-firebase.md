# Build iOS và phát cho người thử qua Firebase App Distribution

Workflow `.github/workflows/release-ios.yml` có hai job, chạy khi push tag `v*` hoặc chạy tay (Actions → Build & Release iOS → Run workflow):

| Job | Ra file | Cần gì | Trạng thái |
| --- | --- | --- | --- |
| `simulator` | `rong-<tag>-ios-simulator.tar.gz` (đính kèm Release) | Không cần tài khoản Apple | Chạy ngay |
| `adhoc` | `rong-<tag>.ipa` (đính kèm Release) và gửi Firebase | Apple Developer, Firebase | Tắt cho tới khi đặt `IOS_ADHOC_ENABLED=true` |

Cả hai build bằng `eas build --local` trên runner macOS của GitHub (repo public nên miễn phí, không tốn lượt build iOS trên cloud EAS).

**Giới hạn của bản ad hoc:** chỉ cài được trên iPhone đã đăng ký UDID với Apple (tối đa 100 máy mỗi năm cho mỗi tài khoản). Firebase chỉ lo gửi email và trang cài; không thay được việc đăng ký máy. Mỗi lần thêm máy mới phải **build lại** để profile có máy đó.

---

## Checklist

- [ ] Mua [Apple Developer Program](https://developer.apple.com/programs/) (99 USD/năm), chờ Apple duyệt.
- [ ] Tạo chứng chỉ và provisioning profile trên EAS ([A](#a-chứng-chỉ-và-profile-trên-eas)).
- [ ] Tạo App Store Connect API key cho EAS ([A.3](#a3-app-store-connect-api-key)).
- [ ] Tạo Firebase project và app iOS ([B](#b-firebase-app-distribution)).
- [ ] Thêm secret và biến trên GitHub ([C](#c-github-secrets-và-biến)).
- [ ] Đặt `GOOGLE_MAPS_IOS_API_KEY` trên EAS (environment `preview`).
- [ ] Thu UDID của người thử, đăng ký, build lại ([D](#d-thêm-người-thử)).

---

## A. Chứng chỉ và profile trên EAS

CI chạy không tương tác nên không đăng nhập Apple ID được. Phải tạo credentials **một lần trên máy bạn**, EAS lưu lại, CI dùng lại.

### A.1 Đăng ký ít nhất một iPhone

```bash
cd apps/mobile
npx eas-cli device:create
```

Chọn "Website": EAS tạo link/QR, mở trên iPhone để cài profile đăng ký, UDID tự gửi về EAS. Profile ad hoc phải có ít nhất một máy.

### A.2 Tạo chứng chỉ và profile

```bash
npx eas-cli credentials -p ios
```

- Chọn build profile **`release`** (workflow dùng profile này cho bản ad hoc), đăng nhập Apple ID, để EAS tự tạo Distribution Certificate và Ad Hoc provisioning profile.
- App có **share extension** (plugin `expo-share-intent`, App Group `group.vn.rong.app`). EAS hỏi credentials cho cả app chính `vn.rong.app` lẫn extension; tạo cho cả hai.
- Cách chắc nhất để EAS bật đủ capability (App Groups) trên Apple: chạy **một lần** `npx eas-cli build -p ios --profile release` trên máy bạn (build cloud, có tương tác). Build đó thành công thì CI dùng lại được.

### A.3 App Store Connect API key

Khi thêm máy mới, profile ad hoc phải tạo lại. CI không đăng nhập Apple ID được, nên cần API key để EAS tự làm:

1. [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api) → Users and Access → Integrations → App Store Connect API → tạo key quyền **Admin**, tải file `.p8` (chỉ tải được một lần).
2. `npx eas-cli credentials -p ios` → App Store Connect: Manage your API Key → thêm key (Key ID, Issuer ID, file `.p8`).

---

## B. Firebase App Distribution

1. [Firebase console](https://console.firebase.google.com/) → tạo project (hoặc dùng project có sẵn).
2. Add app → **iOS**, bundle ID `vn.rong.app`. Không cần tải `GoogleService-Info.plist` (app không dùng Firebase SDK).
3. Project settings → General → app iOS: chép **App ID** (dạng `1:123456789:ios:abc…`) → biến `FIREBASE_IOS_APP_ID`.
4. App Distribution → Testers & Groups → tạo nhóm, ví dụ `testers` (đặt alias trùng với `FIREBASE_TESTER_GROUPS`), thêm email người thử.
5. Service account cho CI: [Google Cloud console](https://console.cloud.google.com/iam-admin/serviceaccounts) của cùng project → tạo service account, vai trò **Firebase App Distribution Admin** → Keys → Add key → JSON. Toàn bộ nội dung file JSON là secret `FIREBASE_SERVICE_ACCOUNT`. **Không commit file này.**

---

## C. GitHub secrets và biến

Repo → Settings:

| Loại | Tên | Ở đâu | Giá trị |
| --- | --- | --- | --- |
| Biến | `IOS_ADHOC_ENABLED` | **Repository** variables (không đặt ở environment: `if` cấp job không đọc được biến environment) | `true` khi đã xong A và B |
| Secret | `FIREBASE_SERVICE_ACCOUNT` | Environment `Production` | Nội dung file JSON ở B.5 |
| Biến | `FIREBASE_IOS_APP_ID` | Repository hoặc environment `Production` | App ID ở B.3 |
| Biến | `FIREBASE_TESTER_GROUPS` | Repository hoặc environment `Production` | Alias nhóm, nhiều nhóm cách nhau dấu phẩy. Bỏ trống = `testers` |

`EXPO_TOKEN` (environment `Production`) đã có sẵn từ workflow APK.

---

## D. Thêm người thử

1. Thêm email người thử vào nhóm trên Firebase App Distribution.
2. Người thử mở email mời **trên iPhone** (Safari), làm theo hướng dẫn đăng ký thiết bị của Firebase.
3. Firebase console → App Distribution → Testers & Groups → **Export Apple UDIDs**.
4. Đăng ký các UDID với EAS: `npx eas-cli device:create` → nhập tay UDID (hoặc gửi người thử link "Website" của EAS ở A.1 thay cho bước 2–3).
5. Build lại: push tag mới, hoặc chạy tay workflow. EAS tạo lại profile ad hoc có máy mới (nhờ API key ở A.3), Firebase gửi email bản mới, người thử bấm cài.

Máy chưa đăng ký mà bấm cài sẽ báo lỗi "Unable to install".

---

## Bản Simulator

`rong-<tag>-ios-simulator.tar.gz` chạy trên iOS Simulator của Mac (có Xcode):

```bash
tar -xzf rong-v1.10.0-ios-simulator.tar.gz
xcrun simctl install booted Rong.app
```

Không cài được lên iPhone thật.
