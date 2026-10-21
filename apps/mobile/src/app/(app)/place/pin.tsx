import type {
  CreateUserPlaceRequest,
  CreateUserPlaceResponse,
  PlaceCategory,
  PlaceNotes,
  RegionSearchResult,
  UpdateUserPlaceRequest,
} from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-context';
import { Glass } from '@/components/glass';
import { PinMap } from '@/components/pin-map';
import type { PinMapHandle, PinMapRegion } from '@/components/pin-map-shared';
import { PlaceNotesForm } from '@/components/place-notes-form';
import { KeyboardAvoider } from '@/components/screen';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { RegionResult } from '@/components/ui/region-result';
import { SearchField } from '@/components/ui/search-field';
import { TextField } from '@/components/ui/text-field';
import { CATEGORIES, CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { usePinAddress } from '@/hooks/use-pin-address';
import { useRegionSearch } from '@/hooks/use-region-search';
import { ApiError } from '@/lib/api';
import { pinnedCandidates } from '@/lib/pinned-candidates';
import { useSavedPlaces } from '@/lib/saved-places';

type Params = {
  regionId?: string;
  regionName?: string;
  /** "minLng,minLat,maxLng,maxLat", như màn Vùng. */
  bbox?: string;
  lat?: string;
  lng?: string;
  name?: string;
  category?: PlaceCategory;
  shareImportId?: string;
  candidateKey?: string;
  hintRegionId?: string;
  hintRegionName?: string;
  /** Sửa điểm tự ghim của chính mình: bắt đầu ở bước ghim, tại vị trí cũ. */
  editPlaceId?: string;
};

/** [minLng, minLat, maxLng, maxLat]. */
type Bbox = [number, number, number, number];
type PickedRegion = { id: string; name: string; bbox: Bbox | null; center: { lat: number; lng: number } | null };
type Step = 'region' | 'pin' | 'info';

/** Nới khung bao vùng ~2 km, khớp kiểm tra của server (`PIN_PADDING_DEG`). */
const PAD = 0.02;
const VIETNAM: PinMapRegion = { lat: 16.0, lng: 106.0, latDelta: 12, lngDelta: 12 };

/**
 * Tự ghim một địa điểm (spec 2026-10-21-user-pinned-places §3): chọn vùng → kéo bản đồ cho ghim đúng chỗ (địa chỉ hiện
 * sau 1 giây đứng yên) → tên, loại, ghi chú → lưu vào "Muốn đi". Cũng dùng để sửa tên, loại, vị trí của điểm đã ghim.
 */
export default function PinPlaceScreen() {
  const params = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const { authFetch } = useAuth();
  const saved = useSavedPlaces();
  const map = useRef<PinMapHandle>(null);
  const editing = !!params.editPlaceId;

  const [region, setRegion] = useState<PickedRegion | null>(
    params.regionId
      ? {
          id: params.regionId,
          name: params.regionName ?? 'Vùng đã chọn',
          bbox: parseBbox(params.bbox),
          center: params.lat && params.lng ? { lat: Number(params.lat), lng: Number(params.lng) } : null,
        }
      : null,
  );
  const [step, setStep] = useState<Step>(region || editing ? 'pin' : 'region');
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [moving, setMoving] = useState(true);
  const address = usePinAddress(moving ? null : center);
  const [name, setName] = useState(params.name ?? '');
  const [category, setCategory] = useState<PlaceCategory>(params.category ?? 'food');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inside = !region?.bbox || !center || insideBbox(center, region.bbox);
  const back = () => (step === 'info' ? setStep('pin') : router.back());

  const save = async (notes: Partial<PlaceNotes>) => {
    // Sửa thì không cần vùng: server kiểm tra theo vùng đã lưu (mở từ lịch trình không có `regionId`).
    if (!center || (!editing && !region)) return;
    if (!name.trim()) {
      setError('Đặt tên cho địa điểm này nhé.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const body: UpdateUserPlaceRequest = {
          name: name.trim(),
          category,
          lat: center.lat,
          lng: center.lng,
          // Chưa có địa chỉ (lỗi, hết lượt): giữ địa chỉ đã lưu thay vì xóa.
          ...(address.address && { address: address.address }),
        };
        await authFetch<void>(`/places/user/${params.editPlaceId}`, { method: 'PATCH', body });
      } else {
        const body: CreateUserPlaceRequest = {
          name: name.trim(),
          category,
          lat: center.lat,
          lng: center.lng,
          regionId: region!.id,
          address: address.address,
          ...(Object.keys(notes).length > 0 && { notes }),
          ...(params.shareImportId && { shareImportId: params.shareImportId }),
        };
        await authFetch<CreateUserPlaceResponse>('/places/user', { method: 'POST', body });
        if (params.shareImportId && params.candidateKey) {
          pinnedCandidates.mark(params.shareImportId, params.candidateKey);
        }
      }
      saved.reload();
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PIN_OUTSIDE_REGION') {
        setStep('pin');
      }
      setError(e instanceof ApiError ? e.message : 'Có lỗi không mong muốn. Thử lại sau.');
      setBusy(false);
    }
  };

  if (step === 'region') {
    return (
      <RegionStep
        topInset={insets.top}
        hint={params.hintRegionId ? { id: params.hintRegionId, name: params.hintRegionName ?? '' } : null}
        onBack={() => router.back()}
        onPick={(picked) => {
          setRegion(picked);
          setStep('pin');
        }}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <PinMap
        ref={map}
        initialRegion={initialMapRegion(region, params)}
        onMoving={() => setMoving(true)}
        onSettled={(c) => {
          setCenter(c);
          setMoving(false);
        }}
      />

      <View style={[styles.topBar, { top: insets.top + Spacing.two }]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={back}>
          <Glass shape="circle" interactive style={styles.round}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
        <Glass shape="capsule" style={styles.title}>
          <Text style={styles.titleText} numberOfLines={1}>
            {region ? `Ghim trong ${region.name}` : 'Ghim vị trí'}
          </Text>
        </Glass>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Vị trí của tôi"
          onPress={() => map.current?.goToMyLocation()}>
          <Glass shape="circle" interactive style={styles.round}>
            <Icon name="pin" color={Colors.light.primary} />
          </Glass>
        </Pressable>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.three }]} pointerEvents="box-none">
        <Glass style={styles.card}>
          {error && step === 'pin' ? <Notice tone="danger">{error}</Notice> : null}
          <AddressLine moving={moving} status={address.status} address={address.address} center={center} />
          {!inside ? <Text style={styles.warning}>{`Ngoài ${region?.name ?? 'vùng đã chọn'}. Kéo ghim vào trong vùng.`}</Text> : null}
          <Button
            label="Ghim ở đây"
            size="lg"
            // Chờ địa chỉ dưới ghim trước khi cho ghim (tối đa ~3 giây; lỗi thì vẫn ghim được với tọa độ).
            disabled={!center || !inside || moving || address.status !== 'done'}
            onPress={() => {
              setError(null);
              setStep('info');
            }}
          />
        </Glass>
      </View>

      <BottomSheet visible={step === 'info'} onClose={() => setStep('pin')}>
        <PlaceNotesForm
          initial={null}
          submitLabel={editing ? 'Lưu' : 'Lưu vào Muốn đi'}
          busy={busy}
          error={error}
          onSubmit={save}
          header={
            <View style={styles.header}>
              <TextField label="Tên địa điểm" value={name} onChangeText={setName} maxLength={120} />
              <View style={styles.chips}>
                {CATEGORIES.map((c) => (
                  <Chip key={c} label={CATEGORY_LABELS[c]} icon={c} selected={category === c} onPress={() => setCategory(c)} />
                ))}
              </View>
              {editing ? <Text style={styles.hint}>Ghi chú sửa ở màn chi tiết địa điểm.</Text> : null}
            </View>
          }
        />
      </BottomSheet>
    </View>
  );
}

function AddressLine({
  moving,
  status,
  address,
  center,
}: {
  moving: boolean;
  status: 'moving' | 'loading' | 'done';
  address: string | null;
  center: { lat: number; lng: number } | null;
}) {
  const coords = center ? `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}` : '';
  if (moving || status === 'moving') {
    return <Text style={styles.addressMuted}>Đang di chuyển…</Text>;
  }
  return (
    <View accessibilityLiveRegion="polite" style={styles.addressBlock}>
      {status === 'loading' ? (
        <ActivityIndicator color={Colors.light.primary} />
      ) : (
        <Text style={styles.address} numberOfLines={2}>
          {address ?? 'Chưa rõ địa chỉ'}
        </Text>
      )}
      <Text style={styles.coords}>{coords}</Text>
    </View>
  );
}

function RegionStep({
  topInset,
  hint,
  onBack,
  onPick,
}: {
  topInset: number;
  hint: { id: string; name: string } | null;
  onBack: () => void;
  onPick: (region: PickedRegion) => void;
}) {
  const { authFetch } = useAuth();
  const [query, setQuery] = useState('');
  const search = useRegionSearch(query);
  const [resolving, setResolving] = useState(false);

  const pickResult = (r: RegionSearchResult) =>
    onPick({ id: r.id, name: r.displayName, bbox: r.bbox, center: r.center });

  // Gợi ý từ bài chỉ có id và tên: tìm theo tên để lấy khung bao; không thấy thì mở bản đồ toàn quốc.
  const pickHint = async (h: { id: string; name: string }) => {
    setResolving(true);
    const results = await authFetch<RegionSearchResult[]>(`/regions/search?q=${encodeURIComponent(h.name)}`).catch(
      () => [] as RegionSearchResult[],
    );
    const match = results.find((r) => r.id === h.id);
    setResolving(false);
    onPick(match ? { id: h.id, name: match.displayName, bbox: match.bbox, center: match.center } : { ...h, bbox: null, center: null });
  };

  return (
    <View style={[styles.regionScreen, { paddingTop: topInset + Spacing.two }]}>
      <KeyboardAvoider>
        <View style={styles.regionHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={onBack}>
            <Glass shape="circle" interactive style={styles.round}>
              <Icon name="back" color={Colors.light.text} />
            </Glass>
          </Pressable>
          <Text style={styles.regionTitle} accessibilityRole="header">
            Địa điểm ở vùng nào?
          </Text>
        </View>
        <View style={styles.regionSearch}>
          <SearchField value={query} onChangeText={setQuery} onSubmitEditing={search.submit} autoFocus={!hint} />
        </View>
        <FlatList
          data={search.results}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.regionList}
          ListHeaderComponent={
            hint ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => pickHint(hint)}
                disabled={resolving}
                style={({ pressed }) => [styles.hintRow, pressed && styles.pressed]}>
                <Icon name="sparkles" color={Colors.light.primary} />
                <Text style={styles.hintText} numberOfLines={1}>{`Gợi ý từ bài: ${hint.name}`}</Text>
                {resolving ? <ActivityIndicator color={Colors.light.primary} /> : null}
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => <RegionResult region={item} onPress={() => pickResult(item)} />}
        />
      </KeyboardAvoider>
    </View>
  );
}

function parseBbox(raw: string | undefined): Bbox | null {
  const parts = raw?.split(',').map(Number);
  return parts && parts.length === 4 && parts.every(Number.isFinite) ? (parts as Bbox) : null;
}

function insideBbox({ lat, lng }: { lat: number; lng: number }, [minLng, minLat, maxLng, maxLat]: Bbox): boolean {
  return lat >= minLat - PAD && lat <= maxLat + PAD && lng >= minLng - PAD && lng <= maxLng + PAD;
}

function initialMapRegion(region: PickedRegion | null, params: Params): PinMapRegion {
  if (params.editPlaceId && params.lat && params.lng) {
    return { lat: Number(params.lat), lng: Number(params.lng), latDelta: 0.01, lngDelta: 0.01 };
  }
  if (region?.bbox) {
    const [minLng, minLat, maxLng, maxLat] = region.bbox;
    return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2, latDelta: maxLat - minLat, lngDelta: maxLng - minLng };
  }
  if (region?.center) return { ...region.center, latDelta: 0.2, lngDelta: 0.2 };
  return VIETNAM;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.light.background },
  topBar: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  round: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minHeight: MinTouch, justifyContent: 'center', paddingHorizontal: Spacing.four },
  titleText: { ...Type.subhead, color: Colors.light.text },
  bottom: { position: 'absolute', left: Spacing.four, right: Spacing.four, bottom: 0 },
  card: { padding: Spacing.four, gap: Spacing.three, borderRadius: Radius.lg },
  addressBlock: { gap: 2, minHeight: 44, justifyContent: 'center' },
  address: { ...Type.body, color: Colors.light.text },
  addressMuted: { ...Type.body, color: Colors.light.textSecondary, minHeight: 44 },
  coords: { ...Type.footnote, color: Colors.light.textSecondary },
  warning: { ...Type.footnote, color: Colors.light.danger },
  header: { gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  regionScreen: { flex: 1, backgroundColor: Colors.light.background },
  regionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  regionTitle: { ...Type.title2, color: Colors.light.text, flex: 1 },
  regionSearch: { padding: Spacing.four },
  regionList: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.eight },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.surface,
  },
  hintText: { ...Type.body, color: Colors.light.text, flex: 1 },
  pressed: { opacity: 0.7 },
});
