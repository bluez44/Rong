import type { StyleProp, ViewStyle } from 'react-native';

import type { IconName } from '@/components/ui/icon';

/** Một điểm trên bản đồ nhỏ (chi tiết địa điểm) hoặc bản đồ ngày của lịch trình. */
export type MapPoint = {
  key: string;
  lat: number;
  lng: number;
  icon: IconName;
  /** Tên hiện trên marker khi đang chọn. */
  label: string;
  /** Số thứ tự trong ngày, vẽ thay cho icon. */
  number?: number;
  /** Vị trí do AI ước đoán. */
  approximate?: boolean;
};

export type PointsMapProps = {
  points: MapPoint[];
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  /** false: bản đồ tĩnh, không kéo/zoom được, chạm vào gọi `onPress`. */
  interactive?: boolean;
  onPress?: () => void;
  /** Khoảng chừa quanh các điểm khi zoom vừa, ví dụ phần bị thẻ chi tiết che. */
  edgePadding?: { top: number; right: number; bottom: number; left: number };
  style?: StyleProp<ViewStyle>;
};
