import type { PublicItinerary } from "@rong/shared-types";
import { cache } from "react";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
/** Backend trên Render ngủ khi vắng: lần đầu có thể mất 30–60 s. Quá thì báo lỗi để người xem thử lại. */
const TIMEOUT_MS = 25_000;

function apiBase(): string {
  return (process.env.RONG_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

/** null khi link không tồn tại hoặc đã thu hồi; lỗi khác thì ném. Không cache: link thu hồi phải chết ngay. */
export async function fetchPublicItinerary(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicItinerary | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const res = await fetchImpl(`${apiBase()}/api/public/itineraries/${token}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backend trả ${res.status} khi lấy lịch trình chia sẻ`);
  return (await res.json()) as PublicItinerary;
}

/** Dùng chung cho generateMetadata và page trong một request. */
export const getPublicItinerary = cache((token: string) => fetchPublicItinerary(token));
