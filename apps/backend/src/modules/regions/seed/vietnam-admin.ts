/**
 * Dữ liệu tham chiếu về địa giới hành chính cấp tỉnh — FR-1.2, FR-1.9.
 *
 * Nguồn: Nghị quyết 202/2025/QH15 sắp xếp đơn vị hành chính cấp tỉnh, có hiệu
 * lực từ 1/7/2025 (63 → 34 tỉnh/thành). Danh sách này là dữ kiện cố định nên
 * được seed thẳng vào database; khung bao của từng vùng thì lấy từ
 * OpenStreetMap khi cần (xem RegionAreaService).
 *
 * Tên tỉnh trong OSM *trước* 1/7/2025 (với tỉnh cũ) hoặc hiện
 * hành (với tỉnh mới) được dùng để tìm đúng relation và khung bao của nó.
 */

export interface OldProvince {
  key: string;
  name: string;
  /** Tiền tố hành chính trong tên chính thức. */
  kind: 'Tỉnh' | 'Thành phố';
  aliases?: string[];
}

export interface NewProvince {
  key: string;
  name: string;
  kind: 'Tỉnh' | 'Thành phố';
  /** Khóa các tỉnh cũ được gộp vào. Tỉnh không đổi địa giới thì để trống. */
  mergedFrom: string[];
  aliases?: string[];
}

export interface SeedDestination {
  key: string;
  name: string;
  /** Tỉnh mới (hiện hành) chứa điểm đến. */
  province: string;
  /** Tỉnh cũ chứa điểm đến trước 1/7/2025. */
  formerProvince: string | null;
  /**
   * Tên đơn vị hành chính cấp huyện trong OSM trước 1/7/2025 mà khung bao của
   * nó được dùng làm khu vực của điểm đến. Đội curate có thể chỉnh lại sau.
   */
  osmFormerDistrict: string;
  aliases?: string[];
}

/** 52 tỉnh/thành cũ đã bị sáp nhập (11 tỉnh không đổi không có bản "cũ"). */
export const OLD_PROVINCES: OldProvince[] = [
  { key: 'ha-giang', name: 'Hà Giang', kind: 'Tỉnh' },
  { key: 'tuyen-quang', name: 'Tuyên Quang', kind: 'Tỉnh' },
  { key: 'lao-cai', name: 'Lào Cai', kind: 'Tỉnh' },
  { key: 'yen-bai', name: 'Yên Bái', kind: 'Tỉnh' },
  { key: 'bac-kan', name: 'Bắc Kạn', kind: 'Tỉnh' },
  { key: 'thai-nguyen', name: 'Thái Nguyên', kind: 'Tỉnh' },
  { key: 'vinh-phuc', name: 'Vĩnh Phúc', kind: 'Tỉnh' },
  { key: 'hoa-binh', name: 'Hòa Bình', kind: 'Tỉnh', aliases: ['Hoà Bình'] },
  { key: 'phu-tho', name: 'Phú Thọ', kind: 'Tỉnh' },
  { key: 'bac-giang', name: 'Bắc Giang', kind: 'Tỉnh' },
  { key: 'bac-ninh', name: 'Bắc Ninh', kind: 'Tỉnh' },
  { key: 'thai-binh', name: 'Thái Bình', kind: 'Tỉnh' },
  { key: 'hung-yen', name: 'Hưng Yên', kind: 'Tỉnh' },
  { key: 'hai-duong', name: 'Hải Dương', kind: 'Tỉnh' },
  { key: 'hai-phong', name: 'Hải Phòng', kind: 'Thành phố' },
  { key: 'ha-nam', name: 'Hà Nam', kind: 'Tỉnh' },
  { key: 'nam-dinh', name: 'Nam Định', kind: 'Tỉnh' },
  { key: 'ninh-binh', name: 'Ninh Bình', kind: 'Tỉnh' },
  { key: 'quang-binh', name: 'Quảng Bình', kind: 'Tỉnh' },
  { key: 'quang-tri', name: 'Quảng Trị', kind: 'Tỉnh' },
  { key: 'quang-nam', name: 'Quảng Nam', kind: 'Tỉnh' },
  { key: 'da-nang', name: 'Đà Nẵng', kind: 'Thành phố' },
  { key: 'kon-tum', name: 'Kon Tum', kind: 'Tỉnh' },
  { key: 'quang-ngai', name: 'Quảng Ngãi', kind: 'Tỉnh' },
  { key: 'binh-dinh', name: 'Bình Định', kind: 'Tỉnh' },
  { key: 'gia-lai', name: 'Gia Lai', kind: 'Tỉnh' },
  { key: 'ninh-thuan', name: 'Ninh Thuận', kind: 'Tỉnh' },
  { key: 'khanh-hoa', name: 'Khánh Hòa', kind: 'Tỉnh', aliases: ['Khánh Hoà'] },
  { key: 'dak-nong', name: 'Đắk Nông', kind: 'Tỉnh', aliases: ['Đăk Nông'] },
  { key: 'binh-thuan', name: 'Bình Thuận', kind: 'Tỉnh' },
  { key: 'lam-dong', name: 'Lâm Đồng', kind: 'Tỉnh' },
  { key: 'phu-yen', name: 'Phú Yên', kind: 'Tỉnh' },
  {
    key: 'dak-lak',
    name: 'Đắk Lắk',
    kind: 'Tỉnh',
    aliases: ['Đăk Lăk', 'Dak Lak'],
  },
  {
    key: 'ba-ria-vung-tau',
    name: 'Bà Rịa - Vũng Tàu',
    kind: 'Tỉnh',
    aliases: ['BRVT', 'Bà Rịa Vũng Tàu'],
  },
  { key: 'binh-duong', name: 'Bình Dương', kind: 'Tỉnh' },
  {
    key: 'ho-chi-minh',
    name: 'TP. Hồ Chí Minh',
    kind: 'Thành phố',
    aliases: ['TP.HCM', 'HCM', 'Sài Gòn'],
  },
  { key: 'binh-phuoc', name: 'Bình Phước', kind: 'Tỉnh' },
  { key: 'dong-nai', name: 'Đồng Nai', kind: 'Tỉnh' },
  { key: 'long-an', name: 'Long An', kind: 'Tỉnh' },
  { key: 'tay-ninh', name: 'Tây Ninh', kind: 'Tỉnh' },
  { key: 'soc-trang', name: 'Sóc Trăng', kind: 'Tỉnh' },
  { key: 'hau-giang', name: 'Hậu Giang', kind: 'Tỉnh' },
  { key: 'can-tho', name: 'Cần Thơ', kind: 'Thành phố' },
  { key: 'ben-tre', name: 'Bến Tre', kind: 'Tỉnh' },
  { key: 'tra-vinh', name: 'Trà Vinh', kind: 'Tỉnh' },
  { key: 'vinh-long', name: 'Vĩnh Long', kind: 'Tỉnh' },
  { key: 'tien-giang', name: 'Tiền Giang', kind: 'Tỉnh' },
  { key: 'dong-thap', name: 'Đồng Tháp', kind: 'Tỉnh' },
  { key: 'bac-lieu', name: 'Bạc Liêu', kind: 'Tỉnh' },
  { key: 'ca-mau', name: 'Cà Mau', kind: 'Tỉnh' },
  { key: 'kien-giang', name: 'Kiên Giang', kind: 'Tỉnh' },
  { key: 'an-giang', name: 'An Giang', kind: 'Tỉnh' },
];

/** 34 tỉnh/thành hiện hành. */
export const NEW_PROVINCES: NewProvince[] = [
  // 11 tỉnh/thành không thay đổi địa giới.
  { key: 'ha-noi', name: 'Hà Nội', kind: 'Thành phố', mergedFrom: [] },
  {
    key: 'hue',
    name: 'Huế',
    kind: 'Thành phố',
    mergedFrom: [],
    aliases: ['Thừa Thiên Huế', 'Thừa Thiên - Huế'],
  },
  { key: 'lai-chau', name: 'Lai Châu', kind: 'Tỉnh', mergedFrom: [] },
  { key: 'dien-bien', name: 'Điện Biên', kind: 'Tỉnh', mergedFrom: [] },
  { key: 'son-la', name: 'Sơn La', kind: 'Tỉnh', mergedFrom: [] },
  { key: 'lang-son', name: 'Lạng Sơn', kind: 'Tỉnh', mergedFrom: [] },
  { key: 'quang-ninh', name: 'Quảng Ninh', kind: 'Tỉnh', mergedFrom: [] },
  {
    key: 'thanh-hoa',
    name: 'Thanh Hóa',
    kind: 'Tỉnh',
    mergedFrom: [],
    aliases: ['Thanh Hoá'],
  },
  { key: 'nghe-an', name: 'Nghệ An', kind: 'Tỉnh', mergedFrom: [] },
  { key: 'ha-tinh', name: 'Hà Tĩnh', kind: 'Tỉnh', mergedFrom: [] },
  { key: 'cao-bang', name: 'Cao Bằng', kind: 'Tỉnh', mergedFrom: [] },
  // 23 tỉnh/thành hình thành từ sáp nhập.
  {
    key: 'tuyen-quang',
    name: 'Tuyên Quang',
    kind: 'Tỉnh',
    mergedFrom: ['tuyen-quang', 'ha-giang'],
  },
  {
    key: 'lao-cai',
    name: 'Lào Cai',
    kind: 'Tỉnh',
    mergedFrom: ['lao-cai', 'yen-bai'],
  },
  {
    key: 'thai-nguyen',
    name: 'Thái Nguyên',
    kind: 'Tỉnh',
    mergedFrom: ['thai-nguyen', 'bac-kan'],
  },
  {
    key: 'phu-tho',
    name: 'Phú Thọ',
    kind: 'Tỉnh',
    mergedFrom: ['phu-tho', 'vinh-phuc', 'hoa-binh'],
  },
  {
    key: 'bac-ninh',
    name: 'Bắc Ninh',
    kind: 'Tỉnh',
    mergedFrom: ['bac-ninh', 'bac-giang'],
  },
  {
    key: 'hung-yen',
    name: 'Hưng Yên',
    kind: 'Tỉnh',
    mergedFrom: ['hung-yen', 'thai-binh'],
  },
  {
    key: 'hai-phong',
    name: 'Hải Phòng',
    kind: 'Thành phố',
    mergedFrom: ['hai-phong', 'hai-duong'],
  },
  {
    key: 'ninh-binh',
    name: 'Ninh Bình',
    kind: 'Tỉnh',
    mergedFrom: ['ninh-binh', 'ha-nam', 'nam-dinh'],
  },
  {
    key: 'quang-tri',
    name: 'Quảng Trị',
    kind: 'Tỉnh',
    mergedFrom: ['quang-tri', 'quang-binh'],
  },
  {
    key: 'da-nang',
    name: 'Đà Nẵng',
    kind: 'Thành phố',
    mergedFrom: ['da-nang', 'quang-nam'],
  },
  {
    key: 'quang-ngai',
    name: 'Quảng Ngãi',
    kind: 'Tỉnh',
    mergedFrom: ['quang-ngai', 'kon-tum'],
  },
  {
    key: 'gia-lai',
    name: 'Gia Lai',
    kind: 'Tỉnh',
    mergedFrom: ['gia-lai', 'binh-dinh'],
  },
  {
    key: 'khanh-hoa',
    name: 'Khánh Hòa',
    kind: 'Tỉnh',
    mergedFrom: ['khanh-hoa', 'ninh-thuan'],
  },
  {
    key: 'lam-dong',
    name: 'Lâm Đồng',
    kind: 'Tỉnh',
    mergedFrom: ['lam-dong', 'dak-nong', 'binh-thuan'],
  },
  {
    key: 'dak-lak',
    name: 'Đắk Lắk',
    kind: 'Tỉnh',
    mergedFrom: ['dak-lak', 'phu-yen'],
  },
  {
    key: 'ho-chi-minh',
    name: 'TP. Hồ Chí Minh',
    kind: 'Thành phố',
    mergedFrom: ['ho-chi-minh', 'binh-duong', 'ba-ria-vung-tau'],
    aliases: ['TP.HCM', 'TPHCM', 'HCM', 'Sài Gòn', 'Saigon'],
  },
  {
    key: 'dong-nai',
    name: 'Đồng Nai',
    kind: 'Tỉnh',
    mergedFrom: ['dong-nai', 'binh-phuoc'],
  },
  {
    key: 'tay-ninh',
    name: 'Tây Ninh',
    kind: 'Tỉnh',
    mergedFrom: ['tay-ninh', 'long-an'],
  },
  {
    key: 'can-tho',
    name: 'Cần Thơ',
    kind: 'Thành phố',
    mergedFrom: ['can-tho', 'soc-trang', 'hau-giang'],
  },
  {
    key: 'vinh-long',
    name: 'Vĩnh Long',
    kind: 'Tỉnh',
    mergedFrom: ['vinh-long', 'ben-tre', 'tra-vinh'],
  },
  {
    key: 'dong-thap',
    name: 'Đồng Tháp',
    kind: 'Tỉnh',
    mergedFrom: ['dong-thap', 'tien-giang'],
  },
  {
    key: 'ca-mau',
    name: 'Cà Mau',
    kind: 'Tỉnh',
    mergedFrom: ['ca-mau', 'bac-lieu'],
  },
  {
    key: 'an-giang',
    name: 'An Giang',
    kind: 'Tỉnh',
    mergedFrom: ['an-giang', 'kien-giang'],
  },
];

/** Điểm đến du lịch — mục 4.1 và Phụ lục A của PRD. */
export const DESTINATIONS: SeedDestination[] = [
  {
    key: 'da-lat',
    name: 'Đà Lạt',
    province: 'lam-dong',
    formerProvince: 'lam-dong',
    osmFormerDistrict: 'Thành phố Đà Lạt',
    aliases: ['Dalat'],
  },
  {
    key: 'bao-loc',
    name: 'Bảo Lộc',
    province: 'lam-dong',
    formerProvince: 'lam-dong',
    osmFormerDistrict: 'Thành phố Bảo Lộc',
  },
  {
    key: 'mui-ne-phan-thiet',
    name: 'Mũi Né – Phan Thiết',
    province: 'lam-dong',
    formerProvince: 'binh-thuan',
    osmFormerDistrict: 'Thành phố Phan Thiết',
    aliases: ['Mũi Né', 'Phan Thiết'],
  },
  {
    key: 'vung-tau',
    name: 'Vũng Tàu',
    province: 'ho-chi-minh',
    formerProvince: 'ba-ria-vung-tau',
    osmFormerDistrict: 'Thành phố Vũng Tàu',
  },
  {
    key: 'con-dao',
    name: 'Côn Đảo',
    province: 'ho-chi-minh',
    formerProvince: 'ba-ria-vung-tau',
    osmFormerDistrict: 'Huyện Côn Đảo',
  },
  {
    key: 'hoi-an',
    name: 'Hội An',
    province: 'da-nang',
    formerProvince: 'quang-nam',
    osmFormerDistrict: 'Thành phố Hội An',
  },
  {
    key: 'phu-quoc',
    name: 'Phú Quốc',
    province: 'an-giang',
    formerProvince: 'kien-giang',
    osmFormerDistrict: 'Thành phố Phú Quốc',
  },
  {
    key: 'nha-trang',
    name: 'Nha Trang',
    province: 'khanh-hoa',
    formerProvince: 'khanh-hoa',
    osmFormerDistrict: 'Thành phố Nha Trang',
  },
  {
    key: 'quy-nhon',
    name: 'Quy Nhơn',
    province: 'gia-lai',
    formerProvince: 'binh-dinh',
    osmFormerDistrict: 'Thành phố Quy Nhơn',
  },
  {
    key: 'sa-pa',
    name: 'Sa Pa',
    province: 'lao-cai',
    formerProvince: 'lao-cai',
    osmFormerDistrict: 'Thị xã Sa Pa',
    aliases: ['Sapa'],
  },
  {
    key: 'ha-long',
    name: 'Hạ Long',
    province: 'quang-ninh',
    formerProvince: null,
    osmFormerDistrict: 'Thành phố Hạ Long',
    aliases: ['Halong'],
  },
];
