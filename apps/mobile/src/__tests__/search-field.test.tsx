import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SearchField } from '@/components/ui/search-field';

const LONG_PLACEHOLDER = 'Tìm quán, điểm tham quan ở Thành phố Hồ Chí Minh và các vùng lân cận';
const LONG_QUERY = 'quán cà phê sân vườn yên tĩnh có chỗ ngồi ngoài trời gần hồ Xuân Hương';
// Dòng chữ đè lên ô bị ẩn khỏi trình đọc màn hình (ô nhập đã có nhãn), nên phải tìm cả phần tử ẩn.
const HIDDEN = { includeHiddenElements: true };

describe('SearchField', () => {
  it('chữ gợi ý chỉ một dòng, dài thì cắt bằng dấu …', async () => {
    await render(<SearchField value="" onChangeText={jest.fn()} placeholder={LONG_PLACEHOLDER} />);
    const hint = screen.getByText(LONG_PLACEHOLDER, HIDDEN);
    expect(hint.props.numberOfLines).toBe(1);
    expect(hint.props.ellipsizeMode).toBe('tail');
    // Không dùng placeholder gốc: trên Android nó tự xuống dòng.
    expect(screen.getByLabelText(LONG_PLACEHOLDER).props.placeholder).toBeFalsy();
  });

  it('chữ đã gõ hiện một dòng có dấu … khi ô không được chọn', async () => {
    await render(<SearchField value={LONG_QUERY} onChangeText={jest.fn()} placeholder="Tìm" />);
    const shown = screen.getByText(LONG_QUERY, HIDDEN);
    expect(shown.props.numberOfLines).toBe(1);
    expect(shown.props.ellipsizeMode).toBe('tail');
    // Chữ của ô nhập ẩn đi để không vẽ chồng lên dòng đã cắt.
    expect(StyleSheet.flatten(screen.getByLabelText('Tìm').props.style).color).toBe('transparent');
  });

  it('đang gõ thì dùng chữ của ô nhập, bỏ dòng đã cắt', async () => {
    const onFocus = jest.fn();
    await render(<SearchField value={LONG_QUERY} onChangeText={jest.fn()} placeholder="Tìm" onFocus={onFocus} />);
    await fireEvent(screen.getByLabelText('Tìm'), 'focus');
    expect(onFocus).toHaveBeenCalled();
    expect(screen.queryByText(LONG_QUERY, HIDDEN)).toBeNull();
    expect(StyleSheet.flatten(screen.getByLabelText('Tìm').props.style).color).not.toBe('transparent');

    await fireEvent(screen.getByLabelText('Tìm'), 'blur');
    expect(screen.getByText(LONG_QUERY, HIDDEN).props.numberOfLines).toBe(1);
  });
});
