import type { NetQuality } from "@/engine/mediasoupClient";

const LABEL: Record<NetQuality, string> = {
  good: "Good connection",
  fair: "Unstable connection",
  poor: "Poor connection",
  offline: "Offline — reconnecting",
};

/** Signal bars for someone's internet quality (3 bars good, 2 fair, 1 poor, crossed out offline). */
export function NetBars({ quality, className = "" }: { quality?: NetQuality; className?: string }) {
  if (!quality) return null;
  const lit = quality === "good" ? 3 : quality === "fair" ? 2 : quality === "poor" ? 1 : 0;
  const color = quality === "good" ? "bg-emerald-400" : quality === "fair" ? "bg-amber-400" : "bg-rose-500";
  return (
    <span role="img" aria-label={LABEL[quality]} title={LABEL[quality]} className={`inline-flex items-end gap-[2px] h-3 ${className}`}>
      {[1, 2, 3].map((n) => (
        <span key={n} className={`w-[3px] rounded-sm ${n <= lit ? color : "bg-zinc-600"}`} style={{ height: `${n * 4}px` }} />
      ))}
      {quality === "offline" && <span className="ml-0.5 text-[9px] font-bold leading-none text-rose-400">!</span>}
    </span>
  );
}
