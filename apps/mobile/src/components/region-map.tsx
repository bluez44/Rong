import type { PlaceListItem } from '@rong/shared-types';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { placeKey, type RegionMapProps } from '@/components/region-map-shared';
import { MapMarker } from '@/components/ui/map-marker';
import { MAX_MAP_MARKERS } from '@/constants/places';
import { Spacing } from '@/constants/theme';

const FALLBACK_DELTA = 0.2;
/** Khung quanh vị trí người dùng khi tự căn giữa lúc mở màn (~3 km). */
const USER_DELTA = 0.03;

export function RegionMap({ bbox, center, places, selectedKey, onSelect, bottomInset, topInset }: RegionMapProps) {
  const map = useRef<MapView>(null);
  const [visible, setVisible] = useState<Region | null>(null);
  const fittedToPlaces = useRef(false);
  const padding = { top: topInset + Spacing.four, right: Spacing.six, bottom: bottomInset + Spacing.four, left: Spacing.six };

  // Chấm vị trí và nút "vị trí của tôi" là của bản đồ; app chỉ cần xin quyền.
  const [locationGranted, setLocationGranted] = useState(false);
  // Chỉ tự căn giữa vào người dùng một lần, ở lần đầu bản đồ báo có vị trí.
  const centeredOnUser = useRef(false);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync()
      .then(({ status }) => setLocationGranted(status === 'granted'))
      .catch(() => undefined);
  }, []);

  const initialRegion: Region | undefined = bbox
    ? {
        latitude: (bbox[1] + bbox[3]) / 2,
        longitude: (bbox[0] + bbox[2]) / 2,
        latitudeDelta: bbox[3] - bbox[1],
        longitudeDelta: bbox[2] - bbox[0],
      }
    : center
      ? { latitude: center.lat, longitude: center.lng, latitudeDelta: FALLBACK_DELTA, longitudeDelta: FALLBACK_DELTA }
      : undefined;

  const fitBbox = () => {
    if (!bbox) return;
    map.current?.fitToCoordinates(
      [
        { latitude: bbox[1], longitude: bbox[0] },
        { latitude: bbox[3], longitude: bbox[2] },
      ],
      { edgePadding: padding, animated: false },
    );
  };

  // Vùng chưa có khung bao (FR-1.5): zoom vừa các địa điểm của trang đầu, nếu chưa căn vào người dùng.
  useEffect(() => {
    if (bbox || fittedToPlaces.current || centeredOnUser.current || places.length === 0) return;
    fittedToPlaces.current = true;
    map.current?.fitToCoordinates(
      places.map((p) => ({ latitude: p.coordinates.lat, longitude: p.coordinates.lng })),
      { edgePadding: padding, animated: true },
    );
  }, [bbox, places]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chọn từ danh sách thì đưa địa điểm vào giữa phần bản đồ còn nhìn thấy.
  const selected = places.find((p) => placeKey(p) === selectedKey) ?? null;
  useEffect(() => {
    if (!selected) return;
    map.current?.animateCamera({ center: { latitude: selected.coordinates.lat, longitude: selected.coordinates.lng } }, { duration: 350 });
  }, [selected]);

  // Chỉ vẽ tối đa 5 điểm cao nhất trong khung nhìn (FR-2.1), luôn kèm điểm đang chọn.
  const inView = visible ? places.filter((p) => contains(visible, p)) : places;
  const markers = [...inView].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, MAX_MAP_MARKERS);
  if (selected && !markers.includes(selected)) markers.push(selected);

  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      provider={PROVIDER_GOOGLE}
      mapPadding={padding}
      onMapReady={fitBbox}
      onRegionChangeComplete={setVisible}
      showsUserLocation={locationGranted}
      showsMyLocationButton={locationGranted}
      onUserLocationChange={({ nativeEvent: { coordinate } }) => {
        if (centeredOnUser.current || !coordinate) return;
        centeredOnUser.current = true;
        map.current?.animateToRegion(
          { latitude: coordinate.latitude, longitude: coordinate.longitude, latitudeDelta: USER_DELTA, longitudeDelta: USER_DELTA },
          500,
        );
      }}
      showsPointsOfInterests={false}
      toolbarEnabled={false}
      showsCompass={false}>
      {markers.map((place) => (
        <PlaceMarker key={placeKey(place)} place={place} selected={placeKey(place) === selectedKey} onPress={() => onSelect(placeKey(place))} />
      ))}
    </MapView>
  );
}

function PlaceMarker({ place, selected, onPress }: { place: PlaceListItem; selected: boolean; onPress: () => void }) {
  // Marker tùy biến chụp lại view mỗi khung hình nếu để tracksViewChanges; chỉ bật lúc vừa đổi trạng thái.
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true); // eslint-disable-line react-hooks/set-state-in-effect
    const timer = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(timer);
  }, [selected]);

  return (
    <Marker
      coordinate={{ latitude: place.coordinates.lat, longitude: place.coordinates.lng }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracking}
      zIndex={selected ? 10 : 1}
      accessibilityLabel={place.name}
      onPress={(e) => {
        e.stopPropagation();
        onPress();
      }}>
      <MapMarker category={place.category} selected={selected} label={place.name} />
    </Marker>
  );
}

function contains(region: Region, place: PlaceListItem): boolean {
  const { lat, lng } = place.coordinates;
  return (
    Math.abs(lat - region.latitude) <= region.latitudeDelta / 2 && Math.abs(lng - region.longitude) <= region.longitudeDelta / 2
  );
}
