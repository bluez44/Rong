# apps/mobile

## Khung màn hình: vùng an toàn và bàn phím

Mọi màn hình mới phải chừa vùng an toàn (tai thỏ, thanh home) và không để bàn phím che ô nhập hay nút bấm.

- **Mặc định bọc màn hình bằng `<Screen>`** (`src/components/screen.tsx`). Nó gồm `SafeAreaView` của
  `react-native-safe-area-context` và `KeyboardAvoidingView` bên trong, đã cấu hình sẵn.
  - `edges`: mặc định `['top', 'bottom']`. Bỏ `'bottom'` khi nội dung là danh sách cuộn được xuống dưới thanh
    home (khi đó tự thêm `paddingBottom` cho `contentContainerStyle`), ví dụ `src/app/(app)/search.tsx`.
  - `contentStyle`: padding, gap... của nội dung; `style`: nền của cả màn hình.
- **Màn có nội dung tràn mép** (ảnh, bản đồ, dải trang trí dưới tai thỏ) thì không dùng `<Screen>`: tự chừa bằng
  `useSafeAreaInsets()`, và nếu có ô nhập thì bọc bằng `<KeyboardAvoider>` (cũng trong `screen.tsx`).
  Ví dụ: `src/components/auth-screen.tsx`, `src/app/(app)/region/[id].tsx`.
- Không dùng `SafeAreaView` của `react-native` (đã lỗi thời, không chạy trên Android), và không tự viết
  `KeyboardAvoidingView` với `behavior` riêng: dùng `<KeyboardAvoider>` để cả app xử lý bàn phím giống nhau.
- Form dài phải nằm trong `ScrollView` (bên trong `<Screen>`/`<KeyboardAvoider>`) với
  `keyboardShouldPersistTaps="handled"` để bấm nút khi bàn phím đang mở vẫn ăn ngay lần đầu.
- Danh sách có ô tìm kiếm: thêm `keyboardShouldPersistTaps="handled"` và `keyboardDismissMode="on-drag"`.
- Kiểm tra trên cả iOS và Android khi bàn phím mở: ô đang gõ, nút gửi và thông báo lỗi phải nhìn thấy được.
