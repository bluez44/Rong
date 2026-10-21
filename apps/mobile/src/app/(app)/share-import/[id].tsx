import type {
  SaveShareImportResponse,
  ShareImport,
  ShareImportCandidate,
  ShareImportSelection,
} from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { useAuth } from '@/auth/auth-context';
import { Glass } from '@/components/glass';
import { Screen } from '@/components/screen';
import { ShareCandidateCard, type CandidateChoice } from '@/components/share-candidate-card';
import { ShareSourceCard } from '@/components/share-source-card';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { TextField } from '@/components/ui/text-field';
import { Colors, MinTouch, Spacing, Type } from '@/constants/theme';
import { useShareImport } from '@/hooks/use-share-import';
import { ApiError } from '@/lib/api';
import { useSavedPlaces } from '@/lib/saved-places';

type Choice = CandidateChoice;
type Selection = Record<string, Choice>;

const UNEXPECTED = 'Có lỗi không mong muốn. Thử lại sau.';

const FAILURE_TEXT: Record<string, string> = {
  METADATA_UNAVAILABLE: 'Không đọc được nội dung link này.',
  AI_UNAVAILABLE: 'Chưa nhận diện được, thử lại sau.',
  TIMEOUT: 'Chưa nhận diện được, thử lại sau.',
  INTERRUPTED: 'Chưa nhận diện được, thử lại sau.',
};

/** Màn xác nhận địa điểm nhận diện từ nội dung được chia sẻ (F4): chọn rồi lưu vào "Muốn đi". */
export default function ShareImportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { job, error, reload } = useShareImport(id);

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Lưu địa điểm từ bài chia sẻ
        </Text>
        {error ? (
          <Notice
            tone="danger"
            title="Chưa tải được"
            action={<Button label="Thử lại" variant="plain" size="sm" onPress={reload} style={styles.inlineAction} />}>
            {error.message}
          </Notice>
        ) : job ? (
          <JobBody id={id} job={job} />
        ) : (
          <ActivityIndicator color={Colors.light.primary} style={styles.loading} />
        )}
      </ScrollView>
    </Screen>
  );
}

function JobBody({ id, job }: { id: string; job: ShareImport }) {
  return (
    <>
      <ShareSourceCard source={job.source} />
      {job.status === 'pending' ? (
        <View style={styles.pendingRow} accessibilityLiveRegion="polite">
          <ActivityIndicator color={Colors.light.primary} />
          <Text style={styles.hint}>Đang tìm địa điểm…</Text>
        </View>
      ) : job.status === 'done' && job.candidates.length > 0 ? (
        <Candidates id={id} candidates={job.candidates} />
      ) : (
        <Retry job={job} />
      )}
    </>
  );
}

function initialSelection(candidates: ShareImportCandidate[]): Selection {
  const selection: Selection = {};
  for (const c of candidates) {
    const first = c.options[0];
    selection[c.key] = c.confidence === 'high' && first ? { candidateKey: c.key, option: first } : null;
  }
  return selection;
}

function Candidates({ id, candidates }: { id: string; candidates: ShareImportCandidate[] }) {
  const { authFetch } = useAuth();
  const saved = useSavedPlaces();
  // Chỉ dựng khi job đã `done`, nên khởi tạo một lần ở đây là đúng lúc job chuyển sang `done`.
  const [selection, setSelection] = useState<Selection>(() => initialSelection(candidates));
  const [saving, setSaving] = useState(false);

  const chosen = Object.values(selection).filter((c): c is NonNullable<Choice> => c !== null);
  const count = chosen.length;

  const save = async () => {
    const selections: ShareImportSelection[] = chosen.map((c) => ({ candidateKey: c.candidateKey, ...c.option.ref }));
    setSaving(true);
    try {
      await authFetch<SaveShareImportResponse>(`/share-imports/${id}/save`, { method: 'POST', body: { selections } });
      saved.reload();
      router.replace('/saved');
    } catch (e) {
      Alert.alert('Chưa lưu được', e instanceof ApiError ? e.message : UNEXPECTED);
      setSaving(false);
    }
  };

  return (
    <>
      {candidates.map((c) => (
        <ShareCandidateCard
          key={c.key}
          shareImportId={id}
          candidate={c}
          choice={selection[c.key] ?? null}
          onChange={(choice) => setSelection((s) => ({ ...s, [c.key]: choice }))}
        />
      ))}
      <Button label={`Lưu ${count} địa điểm`} size="lg" disabled={count === 0} loading={saving} onPress={save} />
    </>
  );
}

/** Nhận diện lỗi hoặc không thấy địa điểm: cho dán mô tả/tên địa điểm để nhận diện lại (FR-4.8). */
function Retry({ job }: { job: ShareImport }) {
  const { authFetch } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const message =
    job.status === 'failed'
      ? (job.errorCode ? FAILURE_TEXT[job.errorCode] : undefined) ?? FAILURE_TEXT.AI_UNAVAILABLE
      : 'Không thấy địa điểm nào trong bài.';

  const retry = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const created = await authFetch<{ id: string }>('/share-imports', { method: 'POST', body: { text: text.trim() } });
      router.replace({ pathname: '/share-import/[id]', params: { id: created.id } });
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : UNEXPECTED);
      setBusy(false);
    }
  };

  return (
    <>
      <Notice tone="warning">{message}</Notice>
      <TextField
        label="Dán mô tả hoặc tên địa điểm"
        value={text}
        onChangeText={setText}
        multiline
        autoCorrect
        error={failure}
        textAlignVertical="top"
      />
      <Button label="Nhận diện lại" disabled={text.trim().length === 0} loading={busy} onPress={retry} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  backGlass: { width: MinTouch, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.eight, gap: Spacing.three },
  title: { ...Type.title1, color: Colors.light.text, marginBottom: Spacing.two },
  loading: { paddingVertical: Spacing.six },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.four },
  hint: { ...Type.callout, color: Colors.light.textSecondary },
});
