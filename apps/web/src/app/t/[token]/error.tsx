"use client";

/** Backend lỗi hoặc đang khởi động (Render ngủ khi vắng): không phải 404, cho người xem thử lại. */
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Chưa tải được lịch trình</h1>
      <p className="text-sm opacity-70">
        Máy chủ đang khởi động hoặc mạng chập chờn. Thử lại sau vài giây.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mx-auto rounded-full bg-pine px-5 py-2 font-semibold text-white"
      >
        Thử lại
      </button>
    </main>
  );
}
