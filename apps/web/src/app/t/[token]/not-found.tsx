export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Link không còn hiệu lực</h1>
      <p className="text-sm opacity-70">
        Link xem lịch trình đã bị thu hồi hoặc không đúng. Xin link mới từ người chia sẻ.
      </p>
    </main>
  );
}
