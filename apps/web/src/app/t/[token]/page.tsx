import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { describeItem, formatDateRange, formatPlanDate, formatTime, notesLine, partyLabel } from "@/lib/format";
import { getPublicItinerary } from "@/lib/public-itinerary";

/**
 * Trang xem lịch trình được chia sẻ — FR-10.3, US-13. Chỉ xem, không cần app. Render phía server
 * để Zalo/Messenger lấy được tiêu đề xem trước. Không cache: link bị thu hồi phải chết ngay.
 */
type PageProps = { params: Promise<{ token: string }> };

const DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL ?? "https://github.com/bluez44/Rong/releases/latest";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const trip = await getPublicItinerary(token).catch(() => null);
  const title = trip
    ? `Lịch trình ${trip.regionName} · ${formatDateRange(trip.startsAt, trip.endsAt)}`
    : "Lịch trình · Rong";
  const description = trip
    ? `${trip.days.length} ngày · ${partyLabel(trip)}. Xem lịch trình trên Rong.`
    : "Xem lịch trình chuyến đi được chia sẻ từ Rong.";
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", url: `/t/${token}` },
  };
}

export default async function SharedItineraryPage({ params }: PageProps) {
  const { token } = await params;
  const trip = await getPublicItinerary(token);
  if (!trip) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-pine">Lịch trình trên Rong</p>
        <h1 className="text-2xl font-bold tracking-tight">{trip.regionName}</h1>
        <p className="text-sm opacity-70">
          {formatDateRange(trip.startsAt, trip.endsAt)} · {trip.days.length} ngày · {partyLabel(trip)}
        </p>
      </header>

      {trip.days.map((day, index) => (
        <section key={day.id} className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">
            Ngày {index + 1} · {formatPlanDate(day.date)}
          </h2>
          {day.items.length === 0 ? (
            <p className="text-sm opacity-60">Chưa có hoạt động.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {day.items.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <span className="w-12 shrink-0 text-sm font-medium tabular-nums text-pine">
                    {formatTime(item.startsAt)}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{describeItem(item)}</p>
                    {notesLine(item.place?.notes) ? (
                      <p className="text-sm opacity-70">{notesLine(item.place?.notes)}</p>
                    ) : null}
                    {item.travelMinutesFromPrevious ? (
                      <p className="text-xs opacity-60">
                        Di chuyển ~{item.travelMinutesFromPrevious} phút
                      </p>
                    ) : null}
                    {item.reason ? (
                      <p className={`text-sm ${item.isAiSuggested ? "text-lavender" : "opacity-70"}`}>
                        {item.reason}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}

      {trip.unscheduled.length > 0 ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">Chưa xếp vào ngày nào</h2>
          <ul className="list-disc pl-5 text-sm">
            {trip.unscheduled.map((u) => (
              <li key={u.placeId}>{u.name ?? "Địa điểm"}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {trip.tips.length > 0 ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold text-lavender">Mẹo cho chuyến đi</h2>
          <ul className="list-disc pl-5 text-sm">
            {trip.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <a
        href={DOWNLOAD_URL}
        className="rounded-full bg-pine px-5 py-3 text-center font-semibold text-white"
      >
        Tải app Rong để lập lịch trình của bạn
      </a>
    </main>
  );
}
