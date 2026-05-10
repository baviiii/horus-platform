export default function Loading() {
  return (
    <div className="mx-auto max-w-[1280px] animate-pulse space-y-6">
      <div className="bg-paper-soft h-3 w-28 rounded" />
      <div className="bg-paper-soft h-10 w-80 rounded" />
      <div className="border-hairline bg-paper rounded-2xl border">
        <div className="border-hairline border-b px-6 py-4">
          <div className="bg-paper-soft h-4 w-32 rounded" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="border-hairline flex items-center gap-4 border-b px-6 py-4 last:border-0"
          >
            <div className="bg-paper-soft h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="bg-paper-soft h-3 w-2/3 rounded" />
              <div className="bg-paper-soft h-2.5 w-1/3 rounded" />
            </div>
            <div className="bg-paper-soft h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
