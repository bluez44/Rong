import type { Metadata } from "next";

/**
 * Trang xem lịch trình được chia sẻ — FR-10.3.
 *
 * Link mời mở được trên web mà không cần cài app: trang chỉ xem, hiển thị đầy
 * đủ lịch trình, bản đồ và chi phí. Render phía server để Zalo/Messenger lấy
 * được ảnh xem trước (Open Graph) khi người dùng dán link.
 *
 * Hiện mới là khung route. Phần lấy dữ liệu sẽ gọi backend NestJS qua token
 * của link mời.
 */

type PageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;

  // TODO: lấy lịch trình theo token để sinh title, description và ảnh OG thật.
  return {
    title: "Lịch trình · Rong",
    description: "Xem lịch trình chuyến đi được chia sẻ từ Rong.",
    openGraph: {
      title: "Lịch trình · Rong",
      description: "Xem lịch trình chuyến đi được chia sẻ từ Rong.",
      type: "website",
      url: `/t/${token}`,
    },
  };
}

export default async function SharedItineraryPage({ params }: PageProps) {
  const { token } = await params;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Lịch trình được chia sẻ</h1>
      <p className="text-sm text-neutral-500">
        Token lời mời: <code className="rounded bg-neutral-100 px-1.5 py-0.5">{token}</code>
      </p>
      <p className="text-sm text-neutral-400">
        Khung route đã sẵn sàng. Phần hiển thị lịch trình, bản đồ và chi phí sẽ
        được nối vào backend ở bước sau.
      </p>
    </main>
  );
}
