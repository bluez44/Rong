import { fireEvent, render, screen } from '@testing-library/react-native';

import { PlaceNotesCard } from '@/components/place-notes-card';

const notes = { note: 'Đi sớm', openingHours: 'Mo-Su 07:00-22:00', priceMin: 50000, priceMax: 150000 };

describe('PlaceNotesCard', () => {
  it('chưa có ghi chú: nút "Thêm ghi chú"', async () => {
    const onEdit = jest.fn();
    await render(<PlaceNotesCard notes={null} onEdit={onEdit} />);
    await fireEvent.press(screen.getByText('Thêm ghi chú'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('có ghi chú: hiện mô tả, tóm tắt giờ và giá, nút "Sửa"', async () => {
    await render(<PlaceNotesCard notes={notes} onEdit={jest.fn()} />);
    expect(screen.getByText('Đi sớm')).toBeTruthy();
    expect(screen.getByText('07:00–22:00 · 50–150k')).toBeTruthy();
    expect(screen.getByText('Sửa')).toBeTruthy();
  });

  it('chỉ xem (ghi chú của người tạo lịch trình): không có nút', async () => {
    await render(<PlaceNotesCard notes={notes} readOnly />);
    expect(screen.getByText('Ghi chú của người tạo lịch trình')).toBeTruthy();
    expect(screen.queryByText('Sửa')).toBeNull();
  });

  it('chỉ xem mà không có ghi chú: không hiện gì', async () => {
    await render(<PlaceNotesCard notes={null} readOnly />);
    expect(screen.toJSON()).toBeNull();
  });
});
