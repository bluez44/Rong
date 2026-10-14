import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { SearchField } from '@/components/ui/search-field';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useAddGooglePlace, type PickedPlace } from '@/hooks/use-add-google-place';
import { usePlaceSearch } from '@/hooks/use-place-search';

/**
 * Tìm và chọn thêm địa điểm khi lập lịch: gõ thì khớp danh sách của vùng;
 * bấm "Tìm trên Google Maps" thì thêm kết quả Google (tính vào hạn mức ngày).
 * Không dùng FlatList: nằm trong ScrollView của form hoặc sheet của màn sửa.
 */
export function PlacePicker({
  regionId,
  exclude,
  onPick,
}: {
  regionId: string;
  exclude?: Set<string>;
  onPick: (place: PickedPlace) => void;
}) {
  const [query, setQuery] = useState('');
  const search = usePlaceSearch(regionId, query);
  const google = useAddGooglePlace(regionId);
  const q = query.trim();
  const fresh = q !== '' && search.status !== 'idle' && search.forQuery !== '';

  const seen = new Set<string>();
  const inRong = fresh
    ? [...search.catalog, ...search.existing].filter((p) => {
        if (seen.has(p.id) || exclude?.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
    : [];
  const fromGoogle = fresh ? (search.google ?? []).filter((h) => h.name) : [];

  const pick = (place: PickedPlace) => {
    onPick(place);
    setQuery('');
  };

  return (
    <View style={styles.wrap}>
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Tìm thêm địa điểm theo tên"
        returnKeyType="search"
        onSubmitEditing={search.submit}
      />
      {q && search.status === 'loading' ? <ActivityIndicator color={Colors.light.primary} /> : null}
      {inRong.map((p) => (
        <Option
          key={p.id}
          title={p.name}
          subtitle={CATEGORY_LABELS[p.category]}
          onPress={() => pick({ id: p.id, name: p.name, category: p.category })}
        />
      ))}
      {fromGoogle.length > 0 ? <Text style={styles.group}>Từ Google Maps</Text> : null}
      {fromGoogle.map((h) => (
        <Option
          key={h.googlePlaceId}
          title={h.name!}
          subtitle={h.address ?? CATEGORY_LABELS[h.suggestedCategory]}
          loading={google.pending === h.googlePlaceId}
          onPress={async () => {
            const picked = await google.add(h);
            if (picked) pick(picked);
          }}
        />
      ))}
      {fresh && search.status === 'done' && !search.searchedOnline ? (
        <Button label="Tìm trên Google Maps" variant="plain" size="sm" onPress={search.submit} style={styles.inline} />
      ) : null}
      {fresh && search.status === 'done' && search.searchedOnline && inRong.length === 0 && fromGoogle.length === 0 ? (
        <Text style={styles.hint}>Không tìm thấy “{q}”.</Text>
      ) : null}
      {search.error ? (
        <Notice tone="danger" title="Chưa tìm được">
          {search.error.message}
        </Notice>
      ) : null}
      {google.error ? (
        <Notice tone="danger" title="Chưa thêm được">
          {google.error.message}
        </Notice>
      ) : null}
    </View>
  );
}

function Option({ title, subtitle, loading, onPress }: { title: string; subtitle: string; loading?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Thêm ${title}, ${subtitle}`}
      accessibilityState={{ busy: !!loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {loading ? <ActivityIndicator color={Colors.light.primary} /> : <Icon name="add" size={18} color={Colors.light.primary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  group: { ...Type.footnote, color: Colors.light.textSecondary, marginTop: Spacing.two },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  pressed: { opacity: 0.7 },
  flex: { flex: 1 },
  title: { ...Type.callout, color: Colors.light.text },
  sub: { ...Type.footnote, color: Colors.light.textSecondary },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  inline: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
});
