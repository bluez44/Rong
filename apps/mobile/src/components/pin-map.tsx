import * as Location from 'expo-location';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import type { PinMapHandle, PinMapProps } from '@/components/pin-map-shared';
import { Icon } from '@/components/ui/icon';
import { Colors, Shadow } from '@/constants/theme';

const PIN_SIZE = 44;

/**
 * Bản đồ toàn màn hình với một ghim cố định giữa màn hình: người dùng kéo bản đồ cho ghim nằm đúng chỗ (màn ghim vị
 * trí). Đầu nhọn của ghim trùng tâm bản đồ.
 */
export const PinMap = forwardRef<PinMapHandle, PinMapProps>(function PinMap(
  { initialRegion, onMoving, onSettled },
  ref,
) {
  const map = useRef<MapView>(null);
  const [locationGranted, setLocationGranted] = useState(false);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync()
      .then(({ status }) => setLocationGranted(status === 'granted'))
      .catch(() => undefined);
  }, []);

  useImperativeHandle(ref, () => ({
    async goToMyLocation() {
      const position = await Location.getCurrentPositionAsync({}).catch(() => null);
      if (!position) return false;
      map.current?.animateToRegion(
        { latitude: position.coords.latitude, longitude: position.coords.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
        400,
      );
      return true;
    },
  }));

  const settle = (region: Region) => onSettled({ lat: region.latitude, lng: region.longitude });

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={{
          latitude: initialRegion.lat,
          longitude: initialRegion.lng,
          latitudeDelta: initialRegion.latDelta,
          longitudeDelta: initialRegion.lngDelta,
        }}
        onMapReady={() => onSettled({ lat: initialRegion.lat, lng: initialRegion.lng })}
        onRegionChange={onMoving}
        onRegionChangeComplete={settle}
        showsUserLocation={locationGranted}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      />
      {/* Ghim cố định: dời lên nửa chiều cao để đầu nhọn nằm đúng tâm bản đồ. */}
      <View pointerEvents="none" style={styles.center}>
        <View style={[styles.pin, Shadow.marker]}>
          <Icon name="pin" size={PIN_SIZE} color={Colors.light.primary} />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  pin: { marginTop: -PIN_SIZE },
});
