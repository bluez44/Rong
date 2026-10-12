/** place_id của Google: chữ, số, `_`, `-`. Chặn ký tự đường dẫn trước khi ghép vào URL Places API. */
export const GOOGLE_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,300}$/;

export function isValidGooglePlaceId(value: string): boolean {
  return GOOGLE_PLACE_ID_PATTERN.test(value);
}
