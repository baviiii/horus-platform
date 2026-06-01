export default function Loading() {
  return (
    <div className="mx-auto max-w-[1280px] animate-pulse space-y-6">
      <div className="bg-paper-soft h-3 w-32 rounded" />
      <div className="bg-paper-soft h-10 w-80 rounded" />
      <div className="border-hairline bg-paper-soft h-[600px] rounded-2xl border" />
    </div>
  );
}
