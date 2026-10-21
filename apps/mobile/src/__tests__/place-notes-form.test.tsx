import type { PlaceNotes } from '@rong/shared-types';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlaceNotesForm } from '@/components/place-notes-form';

// Bộ chọn giờ gốc không chạy trong Jest; form dùng giờ mặc định.
jest.mock('@expo/ui/community/datetime-picker', () => ({ DateTimePicker: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
);

const empty: PlaceNotes = { note: null, openingHours: null, priceMin: null, priceMax: null };

async function renderForm(initial: PlaceNotes | null) {
  const onSubmit = jest.fn();
  await render(<PlaceNotesForm initial={initial} submitLabel="Lưu" onSubmit={onSubmit} />, { wrapper });
  return onSubmit;
}

describe('PlaceNotesForm', () => {
  it('bật giờ mở cửa với mặc định 07:00–22:00 cả tuần: chỉ gửi trường đã đổi', async () => {
    const onSubmit = await renderForm(null);
    await fireEvent(screen.getByLabelText('Có giờ mở cửa'), 'valueChange', true);
    await fireEvent.press(screen.getByText('Lưu'));
    expect(onSubmit).toHaveBeenCalledWith({ openingHours: 'Mo-Su 07:00-22:00' });
  });

  it('bỏ một ngày trong tuần thì chuỗi giờ bỏ ngày đó', async () => {
    const onSubmit = await renderForm(null);
    await fireEvent(screen.getByLabelText('Có giờ mở cửa'), 'valueChange', true);
    await fireEvent.press(screen.getByText('T2'));
    await fireEvent.press(screen.getByText('Lưu'));
    expect(onSubmit).toHaveBeenCalledWith({ openingHours: 'Tu-Su 07:00-22:00' });
  });

  it('chip giá điền hai ô', async () => {
    const onSubmit = await renderForm(null);
    await fireEvent.press(screen.getByText('50–150k'));
    await fireEvent.press(screen.getByText('Lưu'));
    expect(onSubmit).toHaveBeenCalledWith({ priceMin: 50000, priceMax: 150000 });
  });

  it('giờ form không biểu diễn được: hiện chuỗi gốc, sửa ghi chú không đụng tới giờ', async () => {
    const raw = 'Mo-Fr 08:00-12:00,13:30-17:00';
    const onSubmit = await renderForm({ ...empty, openingHours: raw });
    expect(screen.getByText(raw)).toBeTruthy();
    expect(screen.getByText('Xóa giờ')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Ghi chú'), 'Đông vào cuối tuần');
    await fireEvent.press(screen.getByText('Lưu'));
    expect(onSubmit).toHaveBeenCalledWith({ note: 'Đông vào cuối tuần' });
  });

  it('xóa hết ô ghi chú đã có thì gửi null', async () => {
    const onSubmit = await renderForm({ ...empty, note: 'Cũ' });
    await fireEvent.changeText(screen.getByLabelText('Ghi chú'), '  ');
    await fireEvent.press(screen.getByText('Lưu'));
    expect(onSubmit).toHaveBeenCalledWith({ note: null });
  });

  it('giá nhập tay: bỏ dấu chấm, giữ số', async () => {
    const onSubmit = await renderForm(null);
    await fireEvent.changeText(screen.getByLabelText('Giá từ (đ)'), '30.000');
    await fireEvent.press(screen.getByText('Lưu'));
    expect(onSubmit).toHaveBeenCalledWith({ priceMin: 30000 });
  });
});
