import type { ReverseGeocodeResponse } from '@rong/shared-types';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';

type PinAddressState = { status: 'moving' | 'loading' | 'done'; address: string | null };

/**
 * Địa chỉ dưới ghim ở màn ghim vị trí: chỉ hỏi server khi ghim đứng yên `settledMs` (1 giây; kéo tiếp thì đếm lại),
 * phản hồi của vị trí cũ về muộn thì bỏ. Lỗi → `address: null`, màn hình chỉ hiện tọa độ.
 */
export function usePinAddress(center: { lat: number; lng: number } | null, settledMs = 1000): PinAddressState {
  const { authFetch } = useAuth();
  const [state, setState] = useState<PinAddressState>({ status: 'moving', address: null });
  const latest = useRef(0);
  const lat = center?.lat;
  const lng = center?.lng;

  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    const id = ++latest.current;
    setState({ status: 'moving', address: null }); // eslint-disable-line react-hooks/set-state-in-effect
    const timer = setTimeout(() => {
      setState({ status: 'loading', address: null });
      authFetch<ReverseGeocodeResponse>(`/places/reverse-geocode?lat=${lat}&lng=${lng}`)
        .then((r) => {
          if (id === latest.current) setState({ status: 'done', address: r?.address ?? null });
        })
        .catch(() => {
          if (id === latest.current) setState({ status: 'done', address: null });
        });
    }, settledMs);
    return () => clearTimeout(timer);
  }, [lat, lng, settledMs, authFetch]);

  return state;
}
