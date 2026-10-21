import type { ShareImportCandidate, ShareImportOption } from '@rong/shared-types';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { usePinnedCandidates } from '@/lib/pinned-candidates';

export type CandidateChoice = { candidateKey: string; option: ShareImportOption } | null;

type Props = {
  shareImportId: string;
  candidate: ShareImportCandidate;
  choice: CandidateChoice;
  onChange: (choice: CandidateChoice) => void;
};

/**
 * Một địa điểm nhận diện từ bài chia sẻ (F4): tin cậy cao là ô tick, thấp là tối đa 3 lựa chọn, không khớp thì "Tự
 * tìm" hoặc "Ghim vị trí" (tự ghim, spec 2026-10-21-user-pinned-places). Đã ghim trong phiên thì hiện "Đã ghim".
 */
export function ShareCandidateCard({ shareImportId, candidate, choice, onChange }: Props) {
  const pinned = usePinnedCandidates(shareImportId);
  const options = candidate.options.slice(0, 3);
  const first = options[0];

  const pin = () =>
    router.push({
      pathname: '/place/pin',
      params: {
        name: candidate.name,
        category: candidate.category,
        shareImportId,
        candidateKey: candidate.key,
        ...(candidate.regionHint && { hintRegionId: candidate.regionHint.id, hintRegionName: candidate.regionHint.name }),
      },
    });

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{candidate.name}</Text>
      <Text style={styles.meta}>{CATEGORY_LABELS[candidate.category]}</Text>
      {candidate.quote ? (
        <Text style={styles.meta} numberOfLines={2}>
          {candidate.quote}
        </Text>
      ) : null}

      {candidate.confidence === 'high' && first ? (
        <OptionRow
          role="checkbox"
          checked={choice !== null}
          title={first.name ?? candidate.name}
          subtitle={first.regionName}
          onPress={() => onChange(choice ? null : { candidateKey: candidate.key, option: first })}
        />
      ) : candidate.confidence === 'low' && options.length > 0 ? (
        options.map((option) => {
          const checked = choice?.option === option;
          return (
            <OptionRow
              key={optionKey(option)}
              role="radio"
              checked={checked}
              title={option.name ?? candidate.name}
              subtitle={[option.address, option.regionName].filter(Boolean).join(' · ')}
              onPress={() => onChange(checked ? null : { candidateKey: candidate.key, option })}
            />
          );
        })
      ) : pinned.has(candidate.key) ? (
        <Text style={styles.pinned}>Đã ghim ✓ · Đã lưu vào Muốn đi</Text>
      ) : (
        <View style={styles.noneRow}>
          <Text style={styles.hint}>Chưa tìm được địa điểm khớp.</Text>
          <View style={styles.actions}>
            <Button label="Ghim vị trí" size="sm" onPress={pin} />
            <Button label="Tự tìm" variant="plain" size="sm" onPress={() => selfSearch(candidate)} />
          </View>
        </View>
      )}
    </View>
  );
}

/** Mở tìm theo tên trong vùng của gợi ý đầu tiên; không có vùng nào thì về tìm kiếm chung. */
function selfSearch(candidate: ShareImportCandidate) {
  const first = candidate.options[0];
  if (!first) {
    router.push('/search');
    return;
  }
  // Nhánh này hiện chưa chạy tới ("Tự tìm" chỉ hiện khi ứng viên không có lựa chọn); giữ cho khi ứng viên có gợi ý vùng.
  router.push({ pathname: '/region/[id]', params: { id: first.regionId, name: first.regionName, q: candidate.name } });
}

function optionKey(option: ShareImportOption) {
  return option.ref.kind === 'catalog' ? `c:${option.ref.placeId}` : `g:${option.ref.googlePlaceId}`;
}

function OptionRow({
  role,
  checked,
  title,
  subtitle,
  onPress,
}: {
  role: 'checkbox' | 'radio';
  checked: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ checked }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.option, checked && styles.optionChecked, pressed && styles.pressed]}>
      <View style={[styles.mark, role === 'radio' && styles.markRound, checked && styles.markChecked]}>
        {checked ? <View style={[styles.markDot, role === 'radio' && styles.markRound]} /> : null}
      </View>
      <View style={styles.flex}>
        <Text style={styles.optionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.meta}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    gap: Spacing.one,
    padding: Spacing.four,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  name: { ...Type.headline, color: Colors.light.text },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
  hint: { ...Type.callout, color: Colors.light.textSecondary },
  pinned: { ...Type.callout, color: Colors.light.primary, paddingTop: Spacing.two },
  noneRow: { gap: Spacing.two, paddingTop: Spacing.two },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouch,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.sm + 2,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.light.hairline,
  },
  optionChecked: { borderColor: Colors.light.primary, backgroundColor: Colors.light.backgroundSelected },
  pressed: { opacity: 0.7 },
  optionTitle: { ...Type.callout, color: Colors.light.text },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.light.textDisabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markRound: { borderRadius: Radius.pill },
  markChecked: { borderColor: Colors.light.primary, backgroundColor: Colors.light.primary },
  markDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: Colors.light.onPrimary },
});
