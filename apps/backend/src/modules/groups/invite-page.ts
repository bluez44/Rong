import type { InvitePreview, InviteRole } from '@rong/shared-types';

/** Bản APK mới nhất (workflow `release-apk.yml` đăng lên GitHub Releases). */
export const APK_DOWNLOAD_URL =
  'https://github.com/bluez44/Rong/releases/latest';

const ANDROID_PACKAGE = 'vn.rong.app';

const ROLE_LABELS: Record<InviteRole, string> = {
  viewer: 'Chỉ xem',
  editor: 'Chỉnh sửa',
};

const DAY_MONTH = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});

export type InvitePageView =
  { kind: 'ok'; token: string; preview: InvitePreview } | { kind: 'invalid' };

/** Tên nhóm, tên người mời là chữ người dùng đặt: luôn escape trước khi chèn vào HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Trang `/invite/:token` cho người chưa cài app (F10): xem trước lời mời, nút
 * tải APK, nút mở app. Máy đã cài app và xác minh App Links thì không thấy
 * trang này. Màu và font theo design system của app mobile (token Stitch).
 */
export function renderInvitePage(view: InvitePageView): string {
  if (view.kind === 'invalid') {
    return page({
      title: 'Lời mời Rong',
      description: 'Mở bằng app Rong để cùng xem lịch trình',
      body: `<p class="notice">Link mời đã hết hạn hoặc không hợp lệ. Xin link mới từ chủ nhóm.</p>
      ${downloadBlock(null)}`,
    });
  }

  const { preview, token } = view;
  const group = escapeHtml(preview.groupName);
  const inviter = preview.inviterName ? escapeHtml(preview.inviterName) : null;
  const meta = `${preview.memberCount} thành viên · quyền ${ROLE_LABELS[preview.role]} · hết hạn ${dayMonth(preview.expiresAt)}`;
  return page({
    title: inviter
      ? `${inviter} mời bạn vào nhóm ${group}`
      : `Lời mời vào nhóm ${group}`,
    description: 'Mở bằng app Rong để cùng xem lịch trình',
    body: `<section class="hero">
        <div class="band"><span class="dot"></span>${inviter ? `Lời mời từ ${inviter}` : 'Lời mời vào nhóm'}</div>
        <h1>${group}</h1>
        <p class="hero-meta">${meta}</p>
      </section>
      ${downloadBlock(`rong://invite/${encodeURIComponent(token)}`)}`,
  });
}

/** Digital Asset Links cho Android App Links; rỗng khi chưa cấu hình fingerprint. */
export function assetLinks(fingerprints: string[]): object[] {
  if (fingerprints.length === 0) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

/** "26/10" theo giờ Việt Nam (vi-VN tự in "26-10"). */
function dayMonth(iso: string): string {
  const parts = DAY_MONTH.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}`;
}

function downloadBlock(openUrl: string | null): string {
  return `<a class="btn" href="${APK_DOWNLOAD_URL}">Tải app cho Android</a>
      <p class="note">Bản mới nhất trên GitHub Releases (.apk)</p>
      ${openUrl ? `<a class="btn soft" href="${openUrl}">Đã cài app? Mở trong app</a>` : ''}
      <p class="note">iPhone: chưa có bản cài đặt.</p>`;
}

/** `title`, `description` đã escape. */
function page({
  title,
  description,
  body,
}: {
  title: string;
  description: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:site_name" content="Rong">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --forest900:#083C29; --forest100:#BBEED3; --turmeric500:#D99B26; --p50:#FCF9F1; --p200:#F1EEE6; --charcoal:#1C1C17; --muted:#414944; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--p50); color:var(--charcoal); font-family:'Plus Jakarta Sans',system-ui,sans-serif; }
    main { max-width:420px; margin:0 auto; padding:32px 20px 40px; }
    .brand { font-family:'Playfair Display',Georgia,serif; font-weight:700; font-size:30px; color:var(--forest900); margin:0; }
    .tagline { margin:4px 0 0; font-size:14px; color:var(--muted); }
    .hero { margin-top:24px; padding:20px; border-radius:24px; background:var(--forest900); color:#fff; }
    .band { display:flex; align-items:center; gap:8px; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    .dot { width:7px; height:7px; border-radius:50%; background:var(--turmeric500); }
    h1 { font-family:'Playfair Display',Georgia,serif; font-weight:700; font-size:28px; line-height:1.25; margin:10px 0 6px; overflow-wrap:anywhere; }
    .hero-meta { margin:0; font-size:13px; color:var(--forest100); }
    .btn { display:block; margin-top:16px; padding:15px; border-radius:999px; background:var(--forest900); color:#fff; text-align:center; font-weight:700; font-size:16px; text-decoration:none; }
    .btn.soft { background:var(--p200); color:var(--forest900); }
    .note { margin:8px 0 0; text-align:center; font-size:12px; color:var(--muted); }
    .notice { margin:24px 0 0; padding:16px; border-radius:16px; background:var(--p200); font-size:15px; line-height:1.5; }
  </style>
</head>
<body>
  <main>
    <p class="brand">Rong</p>
    <p class="tagline">Lên lịch trình du lịch cùng nhau</p>
    ${body}
  </main>
</body>
</html>
`;
}
