export default function RootLoading() {
  return (
    <div className="bg-paper grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-4">
        <div className="border-hairline border-t-accent h-8 w-8 animate-spin rounded-full border-2" />
        <span className="font-technical text-ink-faded text-[11px] uppercase tracking-[0.22em]">
          Loading
        </span>
      </div>
    </div>
  );
}
