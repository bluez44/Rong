import type { InvitePreview } from '@rong/shared-types';
import { describe, expect, it } from 'vitest';

import {
  APK_DOWNLOAD_URL,
  assetLinks,
  renderInvitePage,
} from './invite-page.js';

const preview: InvitePreview = {
  groupName: 'Đà Lạt cuối tuần',
  inviterName: 'Linh',
  role: 'viewer',
  memberCount: 3,
  expiresAt: '2026-10-26T05:00:00.000Z',
};

describe('renderInvitePage', () => {
  it('trang hợp lệ có tên nhóm, người mời, quyền, hạn, nút tải và mở app', () => {
    const html = renderInvitePage({ kind: 'ok', token: 'tok123', preview });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('Đà Lạt cuối tuần');
    expect(html).toContain('Lời mời từ Linh');
    expect(html).toContain('3 thành viên · quyền Chỉ xem · hết hạn 26/10');
    expect(html).toContain(`href="${APK_DOWNLOAD_URL}"`);
    expect(html).toContain('href="rong://invite/tok123"');
    expect(html).toContain(
      '<meta property="og:title" content="Linh mời bạn vào nhóm Đà Lạt cuối tuần"',
    );
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain('iPhone: chưa có bản cài đặt.');
  });

  it('escapes user text', () => {
    const html = renderInvitePage({
      kind: 'ok',
      token: 't',
      preview: {
        ...preview,
        groupName: '<script>alert(1)</script>',
        inviterName: 'A & "B"',
      },
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A &amp; &quot;B&quot;');
  });

  it('quyền chỉnh sửa và người mời không tên', () => {
    const html = renderInvitePage({
      kind: 'ok',
      token: 't',
      preview: { ...preview, role: 'editor', inviterName: null },
    });
    expect(html).toContain('quyền Chỉnh sửa');
    expect(html).toContain('Lời mời vào nhóm');
  });

  it('link không dùng được vẫn có nút tải app, không có nút mở app', () => {
    const html = renderInvitePage({ kind: 'invalid' });
    expect(html).toContain(
      'Link mời đã hết hạn hoặc không hợp lệ. Xin link mới từ chủ nhóm.',
    );
    expect(html).toContain(`href="${APK_DOWNLOAD_URL}"`);
    expect(html).not.toContain('rong://invite/');
  });
});

describe('assetLinks', () => {
  it('rỗng khi chưa có fingerprint, ngược lại trỏ tới package của app', () => {
    expect(assetLinks([])).toEqual([]);
    expect(assetLinks(['AA:BB'])[0]).toMatchObject({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'vn.rong.app',
        sha256_cert_fingerprints: ['AA:BB'],
      },
    });
  });
});
