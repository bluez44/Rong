import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';

/** Chữ trên nút không bao giờ xuống dòng: dài quá (chữ hệ thống phóng to) thì cắt bằng "…". */
function expectOneLine(text: string) {
  const label = screen.getByText(text);
  expect(label.props.numberOfLines).toBe(1);
  expect(label.props.ellipsizeMode ?? 'tail').toBe('tail');
  // Không co lại thì nhãn tràn khỏi nút thay vì hiện dấu …
  expect(StyleSheet.flatten(label.props.style).flexShrink).toBe(1);
}

describe('nhãn nút một dòng', () => {
  it.each(['sm', 'md', 'lg'] as const)('Button %s', async (size) => {
    await render(<Button label="Lưu thành chuyến của tôi" size={size} onPress={jest.fn()} />);
    expectOneLine('Lưu thành chuyến của tôi');
  });

  it('Button đang tải', async () => {
    await render(<Button label="Đang lưu" loading onPress={jest.fn()} />);
    expectOneLine('Đang lưu');
  });

  it('Chip', async () => {
    await render(<Chip label="Vui chơi trẻ em" icon="kids" onPress={jest.fn()} />);
    expectOneLine('Vui chơi trẻ em');
  });
});
