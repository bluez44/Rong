import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ItineraryRole } from '@rong/shared-types';
import { Alert } from 'react-native';

import { RemoveFromGroupButton } from '@/components/remove-from-group-button';

const mockAuthFetch = jest.fn();
jest.mock('@/auth/auth-context', () => ({
  useAuth: () => ({ authFetch: mockAuthFetch }),
}));

const trip = (myRole: ItineraryRole, groupId: string | null = 'g1') => ({
  id: 'it1',
  groupId,
  groupName: groupId ? 'Nhóm Đà Lạt' : null,
  myRole,
});

/** Bấm nút "Gỡ" trong hộp xác nhận. */
function confirmAlert() {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
}

describe('RemoveFromGroupButton', () => {
  beforeEach(() => {
    mockAuthFetch.mockReset().mockResolvedValue(undefined);
    jest.restoreAllMocks();
  });

  it.each<ItineraryRole>(['creator', 'owner'])('%s thấy nút gỡ khi lịch trình thuộc nhóm', async (role) => {
    await render(<RemoveFromGroupButton itinerary={trip(role)} onRemoved={jest.fn()} />);
    expect(screen.getByText('Gỡ khỏi nhóm')).toBeTruthy();
  });

  it.each<ItineraryRole>(['editor', 'viewer'])('%s không thấy nút gỡ', async (role) => {
    await render(<RemoveFromGroupButton itinerary={trip(role)} onRemoved={jest.fn()} />);
    expect(screen.queryByText('Gỡ khỏi nhóm')).toBeNull();
  });

  it('lịch trình cá nhân không có nút gỡ', async () => {
    await render(<RemoveFromGroupButton itinerary={trip('creator', null)} onRemoved={jest.fn()} />);
    expect(screen.queryByText('Gỡ khỏi nhóm')).toBeNull();
  });

  it('xác nhận thì gọi DELETE /groups/:groupId/itineraries/:id; người tạo vẫn còn lịch trình', async () => {
    confirmAlert();
    const onRemoved = jest.fn();
    await render(<RemoveFromGroupButton itinerary={trip('creator')} onRemoved={onRemoved} />);
    await fireEvent.press(screen.getByText('Gỡ khỏi nhóm'));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(true));
    expect(mockAuthFetch).toHaveBeenCalledWith('/groups/g1/itineraries/it1', { method: 'DELETE' });
  });

  it('chủ nhóm gỡ xong thì không còn xem được lịch trình', async () => {
    confirmAlert();
    const onRemoved = jest.fn();
    await render(<RemoveFromGroupButton itinerary={trip('owner')} onRemoved={onRemoved} />);
    await fireEvent.press(screen.getByText('Gỡ khỏi nhóm'));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(false));
  });

  it('hủy xác nhận thì không gọi API', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<RemoveFromGroupButton itinerary={trip('creator')} onRemoved={jest.fn()} />);
    await fireEvent.press(screen.getByText('Gỡ khỏi nhóm'));
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});
