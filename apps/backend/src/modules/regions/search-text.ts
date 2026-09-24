/**
 * Chuẩn hóa tên để so khớp: bỏ dấu tiếng Việt (kể cả "đ"), hạ chữ thường, bỏ
 * ký tự không phải chữ/số. "Đà Lạt" và "da lat" cho ra cùng một chuỗi (FR-1.1).
 *
 * Làm ở tầng ứng dụng thay vì extension unaccent: kết quả giống hệt nhau cho
 * dữ liệu ghi vào database và từ khóa người dùng gõ, và test được không cần DB.
 */
export function foldText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tiền tố hành chính không mang nghĩa khi tìm: "Tỉnh Lâm Đồng" ≡ "Lâm Đồng". */
const ADMIN_PREFIX =
  /^(tinh|thanh pho|tp|thi xa|tx|thi tran|huyen|quan|phuong|xa|dac khu)\s+/;

/** Khóa tìm kiếm: bỏ dấu, rồi bỏ tiền tố hành chính ở đầu. */
export function searchKey(raw: string): string {
  const folded = foldText(raw);
  const stripped = folded.replace(ADMIN_PREFIX, '');
  return stripped.length > 0 ? stripped : folded;
}

/** Tên có mang tiền tố của xã/phường/đặc khu hay không — dùng để xếp nhóm FR-1.4. */
export function isWardName(raw: string): boolean {
  return /^(phuong|xa|thi tran|dac khu)\s+/.test(foldText(raw));
}
