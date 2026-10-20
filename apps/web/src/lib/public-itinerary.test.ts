import { describe, expect, it, vi } from "vitest";

import { fetchPublicItinerary } from "./public-itinerary";

const TOKEN = "A".repeat(42) + "b";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("fetchPublicItinerary", () => {
  it("token sai dạng thì null, không gọi backend", async () => {
    const fetchImpl = respond(200, {});
    for (const bad of ["abc", "%00", "A".repeat(44)]) {
      expect(await fetchPublicItinerary(bad, fetchImpl)).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("backend 404 thì null", async () => {
    const fetchImpl = respond(404, { code: "SHARE_LINK_NOT_FOUND" });
    expect(await fetchPublicItinerary(TOKEN, fetchImpl)).toBeNull();
  });

  it("200 thì trả dữ liệu, gọi đúng URL và không cache", async () => {
    process.env.RONG_API_URL = "https://api.example.vn/";
    const fetchImpl = respond(200, { regionName: "Đà Lạt" });
    expect(await fetchPublicItinerary(TOKEN, fetchImpl)).toEqual({ regionName: "Đà Lạt" });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.vn/api/public/itineraries/${TOKEN}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("lỗi khác 404 thì ném, để trang lỗi cho thử lại", async () => {
    await expect(fetchPublicItinerary(TOKEN, respond(502, {}))).rejects.toThrow();
  });
});
