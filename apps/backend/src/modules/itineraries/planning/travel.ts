import type { Transport } from '@rong/shared-types';

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(x));
}

/**
 * Ước tính thời gian di chuyển, chưa dùng Google Routes: đường thực tế dài hơn
 * đường chim bay khoảng 35%, tốc độ trung bình trong phố du lịch Việt Nam.
 * Đủ để gom cụm theo ngày và phát hiện chặng bất khả thi; thay bằng Routes API sau.
 */
const ROAD_FACTOR = 1.35;
const SPEED_KMH: Record<Transport, number> = {
  motorbike: 25,
  car: 28,
  taxi: 28,
};
const WALK_KM = 0.4;

export interface Leg {
  km: number;
  minutes: number;
}

export function estimateLeg(
  from: LatLng,
  to: LatLng,
  transport: Transport,
): Leg {
  const straight = haversineKm(from, to);
  if (straight <= WALK_KM) {
    return {
      km: Math.round(straight * 10) / 10,
      minutes: Math.max(3, Math.round((straight / 4.5) * 60)),
    };
  }
  const km = straight * ROAD_FACTOR;
  // Cộng 5 phút cho lấy xe, tìm chỗ đỗ.
  return {
    km: Math.round(km * 10) / 10,
    minutes: Math.round((km / SPEED_KMH[transport]) * 60) + 5,
  };
}
