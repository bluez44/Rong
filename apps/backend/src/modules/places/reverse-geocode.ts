/** Thứ tự các phần của một dòng địa chỉ Việt Nam lấy từ `address` của Nominatim. */
const PARTS: string[][] = [
  ['road', 'pedestrian', 'footway', 'path'],
  ['quarter', 'suburb', 'neighbourhood', 'village', 'hamlet'],
  ['city_district', 'district', 'county', 'town'],
  ['city', 'municipality'],
  ['state', 'province'],
];

/** Một dòng địa chỉ tiếng Việt; bỏ phần trùng, mã bưu chính và quốc gia. Không có gì dùng được → null. */
export function formatAddress(
  address: Record<string, string> | undefined,
): string | null {
  if (!address) return null;
  const out: string[] = [];
  for (const keys of PARTS) {
    const value = keys.map((k) => address[k]?.trim()).find(Boolean);
    if (value && !out.includes(value)) out.push(value);
  }
  if (out.length === 0) return null;
  const road = address.road?.trim();
  if (address.house_number?.trim() && road && out[0] === road) {
    out[0] = `${address.house_number.trim()} ${road}`;
  }
  return out.join(', ');
}

/** Ô ~10 m: làm tròn tọa độ 4 chữ số thập phân. */
export function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}
