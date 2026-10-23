import { focusManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { ApiError } from '@/lib/api';

import { connectFocusManager, createQueryClient, shouldRetry } from './query-client';

describe('shouldRetry', () => {
  it('mất mạng và lỗi máy chủ: thử lại tối đa 2 lần', () => {
    const network = new ApiError(0, 'NETWORK_ERROR', 'mạng');
    expect(shouldRetry(0, network)).toBe(true);
    expect(shouldRetry(1, network)).toBe(true);
    expect(shouldRetry(2, network)).toBe(false);
    expect(shouldRetry(0, new ApiError(503, 'HTTP_503', 'bận'))).toBe(true);
  });

  it('4xx (kể cả hết phiên) không thử lại', () => {
    expect(shouldRetry(0, new ApiError(401, 'SESSION_EXPIRED', 'hết phiên'))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, 'NOT_FOUND', 'không có'))).toBe(false);
    expect(shouldRetry(0, new ApiError(400, 'VALIDATION_ERROR', 'sai'))).toBe(false);
  });

  it('5xx có mã riêng của backend (ví dụ PLACES_UNAVAILABLE) không thử lại: gọi lại là chạy lại việc tốn tiền', () => {
    expect(shouldRetry(0, new ApiError(503, 'PLACES_UNAVAILABLE', 'chưa có'))).toBe(false);
    expect(shouldRetry(0, new ApiError(503, 'PROVIDER_NOT_CONFIGURED', 'thiếu cấu hình'))).toBe(false);
    expect(shouldRetry(0, new ApiError(502, 'HTTP_502', 'gateway'))).toBe(true);
  });

  it('lỗi lạ coi như UNKNOWN: không thử lại', () => {
    expect(shouldRetry(0, new Error('boom'))).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('mặc định: staleTime 30 s, query dùng shouldRetry, mutation không retry', () => {
    const client = createQueryClient();
    const { queries, mutations } = client.getDefaultOptions();
    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.retry).toBe(shouldRetry);
    expect(mutations?.retry).toBe(false);
  });
});

describe('connectFocusManager', () => {
  it('AppState active → focused, background → không; gỡ listener khi dọn', () => {
    const remove = jest.fn();
    let listener: (state: string) => void = () => undefined;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler as (state: string) => void;
      return { remove } as never;
    });
    const disconnect = connectFocusManager();
    listener('background');
    expect(focusManager.isFocused()).toBe(false);
    listener('active');
    expect(focusManager.isFocused()).toBe(true);
    disconnect();
    expect(remove).toHaveBeenCalled();
    spy.mockRestore();
  });
});
