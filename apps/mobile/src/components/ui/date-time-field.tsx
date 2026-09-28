import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { formatDateTime } from '@/lib/trip-format';

type DateTimeFieldProps = {
  label: string;
  value: Date;
  onChange: (value: Date) => void;
  minimumDate?: Date;
  error?: string | null;
};

/**
 * Chọn ngày + giờ. iOS: picker compact gốc (mở popover khi chạm). Android không
 * có picker ngày giờ gộp nên mở hộp thoại ngày rồi tới hộp thoại giờ.
 * Ngày giờ hiển thị theo giờ Việt Nam vì chuyến đi luôn ở Việt Nam.
 */
export function DateTimeField({ label, value, onChange, minimumDate, error }: DateTimeFieldProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {Platform.OS === 'android' ? (
        <AndroidField label={label} value={value} onChange={onChange} minimumDate={minimumDate} error={error} />
      ) : (
        <View style={[styles.box, styles.iosBox, !!error && styles.boxError]}>
          <Icon name="calendar" size={18} color={Colors.light.primary} />
          <DateTimePicker
            value={value}
            mode="datetime"
            display="compact"
            minimumDate={minimumDate}
            accentColor={Colors.light.primary}
            locale="vi_VN"
            timeZoneName="Asia/Ho_Chi_Minh"
            themeVariant="light"
            onValueChange={(_, date) => onChange(date)}
          />
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function AndroidField({ label, value, onChange, minimumDate, error }: DateTimeFieldProps) {
  const [step, setStep] = useState<'date' | 'time' | null>(null);
  // Ngày vừa chọn ở bước 1, chờ ghép với giờ ở bước 2.
  const [pickedDay, setPickedDay] = useState<Date>(value);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDateTime(value)}`}
        accessibilityHint="Chạm để đổi ngày và giờ"
        onPress={() => setStep('date')}
        style={({ pressed }) => [styles.box, !!error && styles.boxError, pressed && styles.pressed]}>
        <Icon name="calendar" size={18} color={Colors.light.primary} />
        <Text style={styles.value}>{formatDateTime(value)}</Text>
      </Pressable>
      {step === 'date' ? (
        <DateTimePicker
          key="date"
          value={value}
          mode="date"
          minimumDate={minimumDate}
          accentColor={Colors.light.primary}
          positiveButton={{ label: 'Tiếp' }}
          negativeButton={{ label: 'Hủy' }}
          onDismiss={() => setStep(null)}
          onValueChange={(_, date) => {
            // Hộp thoại ngày của Material trả về 00:00 UTC của ngày được chọn.
            const utcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0;
            const day = new Date(value);
            day.setFullYear(
              utcMidnight ? date.getUTCFullYear() : date.getFullYear(),
              utcMidnight ? date.getUTCMonth() : date.getMonth(),
              utcMidnight ? date.getUTCDate() : date.getDate(),
            );
            setPickedDay(day);
            setStep('time');
          }}
        />
      ) : null}
      {step === 'time' ? (
        <DateTimePicker
          key="time"
          value={pickedDay}
          mode="time"
          is24Hour
          accentColor={Colors.light.primary}
          positiveButton={{ label: 'Xong' }}
          negativeButton={{ label: 'Hủy' }}
          onDismiss={() => setStep(null)}
          onValueChange={(_, time) => {
            const next = new Date(pickedDay);
            next.setHours(time.getHours(), time.getMinutes(), 0, 0);
            onChange(next);
            setStep(null);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one + 2 },
  label: { ...Type.subhead, color: Colors.light.text },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch + 8,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    backgroundColor: Colors.light.surface,
  },
  iosBox: { paddingVertical: Spacing.one },
  boxError: { borderColor: Colors.light.danger },
  pressed: { opacity: 0.7 },
  value: { ...Type.body, color: Colors.light.text },
  error: { ...Type.footnote, color: Colors.light.danger },
});
