/** Vùng mở bản đồ ghim: tâm và độ rộng (độ). */
export type PinMapRegion = { lat: number; lng: number; latDelta: number; lngDelta: number };

export type PinMapProps = {
  initialRegion: PinMapRegion;
  /** Bản đồ bắt đầu di chuyển (người dùng kéo). */
  onMoving: () => void;
  /** Bản đồ dừng: tọa độ dưới ghim. */
  onSettled: (center: { lat: number; lng: number }) => void;
};

export type PinMapHandle = {
  /** Đưa bản đồ tới vị trí hiện tại; false khi không lấy được vị trí. */
  goToMyLocation: () => Promise<boolean>;
};
