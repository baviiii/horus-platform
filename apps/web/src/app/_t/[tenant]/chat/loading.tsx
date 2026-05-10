export default function Loading() {
  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-[1080px] animate-pulse flex-col gap-6">
      <div className="bg-paper-soft h-3 w-24 rounded" />
      <div className="bg-paper-soft h-9 w-72 rounded" />
      <div className="border-hairline bg-paper-soft flex-1 rounded-2xl border" />
      <div className="border-hairline bg-paper-soft h-14 rounded-full border" />
    </div>
  );
}
