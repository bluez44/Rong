import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import type { MapPoint, PointsMapProps } from '@/components/points-map-shared';
import { MapMarker } from '@/components/ui/map-marker';

/** Một điểm duy nhất: khung khoảng 1 km quanh nó. */
const SINGLE_DELTA = 0.01;
const DEFAULT_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

/**
 * Bản đồ vẽ một nhóm điểm cố định và zoom vừa chúng. Dùng chung cho bản đồ nhỏ ở
 * chi tiết địa điểm và bản đồ ngày của lịch trình, để đổi nhà cung cấp bản đồ chỉ
 * phải sửa ở đây và `region-map.tsx`.
 */
export function PointsMap({ points, selectedKey, onSelect, interactive = true, onPress, edgePadding, style }: PointsMapProps) {
  const map = useRef<MapView>(null);
  const padding = edgePadding ?? DEFAULT_PADDING;
  const first = points[0];

  const fit = () => {
    if (points.length < 2) return;
    map.current?.fitToCoordinates(
      points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: padding, animated: false },
    );
  };

  // Danh sách điểm đổi (ví dụ tải lại lịch trình) thì zoom lại cho vừa.
  const pointsKey = points.map((p) => `${p.key}:${p.lat},${p.lng}`).join('|');
  useEffect(fit, [pointsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = points.find((p) => p.key === selectedKey) ?? null;
  useEffect(() => {
    if (!selected) return;
    map.current?.animateCamera({ center: { latitude: selected.lat, longitude: selected.lng } }, { duration: 350 });
  }, [selected]);

  if (!first) return null;

  const mapView = (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      provider={PROVIDER_GOOGLE}
      initialRegion={{ latitude: first.lat, longitude: first.lng, latitudeDelta: SINGLE_DELTA, longitudeDelta: SINGLE_DELTA }}
      onMapReady={fit}
      onPress={() => onSelect?.(null)}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={false}
      pitchEnabled={false}
      showsPointsOfInterests={false}
      toolbarEnabled={false}
      showsCompass={false}>
      {points.map((point) => (
        <PointMarker
          key={point.key}
          point={point}
          selected={point.key === selectedKey}
          onPress={interactive ? () => onSelect?.(point.key) : undefined}
        />
      ))}
    </MapView>
  );

  if (interactive) return <View style={style}>{mapView}</View>;
  // Bản đồ tĩnh: một lớp phủ nhận chạm để bản đồ không giành cử chỉ cuộn của màn hình.
  return (
    <View style={style}>
      {mapView}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Mở chỉ đường tới ${first.label}`}
        onPress={onPress}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function PointMarker({ point, selected, onPress }: { point: MapPoint; selected: boolean; onPress?: () => void }) {
  // Marker tùy biến chụp lại view mỗi khung hình nếu để tracksViewChanges; chỉ bật lúc vừa đổi trạng thái.
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true); // eslint-disable-line react-hooks/set-state-in-effect
    const timer = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(timer);
  }, [selected]);

  return (
    <Marker
      coordinate={{ latitude: point.lat, longitude: point.lng }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracking}
      zIndex={selected ? 10 : 1}
      accessibilityLabel={point.number ? `${point.number}. ${point.label}` : point.label}
      onPress={(e) => {
        e.stopPropagation();
        onPress?.();
      }}>
      <MapMarker icon={point.icon} number={point.number} selected={selected} label={point.label} approximate={point.approximate} />
    </Marker>
  );
}
