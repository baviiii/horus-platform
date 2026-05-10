export default function Loading() {
  return (
    <div className="mx-auto max-w-[1280px] animate-pulse">
      <div className="mb-10">
        <div className="bg-paper-soft h-3 w-32 rounded" />
        <div className="bg-paper-soft mt-4 h-10 w-72 rounded" />
        <div className="bg-paper-soft mt-3 h-4 w-96 rounded" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-hairline bg-paper-soft h-24 rounded-2xl border" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="border-hairline bg-paper-soft h-72 rounded-2xl border lg:col-span-7" />
        <div className="border-hairline bg-paper-soft h-72 rounded-2xl border lg:col-span-5" />
      </div>
    </div>
  );
}
