import { describe, expect, it } from 'vitest';

import {
  atLeast,
  decide,
  roleAfterAccept,
  type ItineraryAction,
  type ItineraryAccess,
} from './access.js';

describe('decide — bảng quyền trên lịch trình (spec S8 mục 4.6)', () => {
  const actions: ItineraryAction[] = ['view', 'edit', 'delete', 'move'];
  const cases: Array<[string, ItineraryAccess, string[]]> = [
    // tên, quyền, kết quả theo thứ tự view, edit, delete, move
    [
      'người tạo, không nhóm',
      { isCreator: true, groupRole: null },
      ['allow', 'allow', 'allow', 'allow'],
    ],
    [
      'người tạo là viewer của nhóm',
      { isCreator: true, groupRole: 'viewer' },
      ['allow', 'allow', 'allow', 'allow'],
    ],
    [
      'owner nhóm',
      { isCreator: false, groupRole: 'owner' },
      ['allow', 'allow', 'allow', 'forbidden'],
    ],
    [
      'editor',
      { isCreator: false, groupRole: 'editor' },
      ['allow', 'allow', 'forbidden', 'forbidden'],
    ],
    [
      'viewer',
      { isCreator: false, groupRole: 'viewer' },
      ['allow', 'forbidden', 'forbidden', 'forbidden'],
    ],
    [
      'không liên quan',
      { isCreator: false, groupRole: null },
      ['not_found', 'not_found', 'not_found', 'not_found'],
    ],
  ];

  for (const [name, access, expected] of cases) {
    it(name, () => {
      expect(actions.map((a) => decide(access, a))).toEqual(expected);
    });
  }
});

describe('atLeast', () => {
  it('so vai trò theo thứ bậc viewer < editor < owner', () => {
    expect(atLeast('owner', 'editor')).toBe(true);
    expect(atLeast('editor', 'editor')).toBe(true);
    expect(atLeast('viewer', 'editor')).toBe(false);
    expect(atLeast(null, 'viewer')).toBe(false);
  });
});

describe('roleAfterAccept — chấp nhận lời mời', () => {
  it('chưa là thành viên thì nhận vai trò của link', () => {
    expect(roleAfterAccept(null, 'viewer')).toBe('viewer');
    expect(roleAfterAccept(null, 'editor')).toBe('editor');
  });

  it('chỉ nâng, không bao giờ hạ; owner giữ owner', () => {
    expect(roleAfterAccept('viewer', 'editor')).toBe('editor');
    expect(roleAfterAccept('editor', 'viewer')).toBeNull();
    expect(roleAfterAccept('editor', 'editor')).toBeNull();
    expect(roleAfterAccept('owner', 'editor')).toBeNull();
  });
});
