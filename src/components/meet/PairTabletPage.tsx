import React, { useState } from "react";
import { Tablet, ArrowRight, Loader2, CheckCircle2, ShieldCheck, PenTool } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { formatTabletCode, normalizeTabletCode } from "../../utils/tabletCode";
import { toast } from "sonner";

interface PairTabletPageProps {
  onPaired: (data: { classId: string; token: string; isPenDevice: boolean }) => void;
  onBackToHome: () => void;
}

export const PairTabletPage: React.FC<PairTabletPageProps> = ({
  onPaired,
  onBackToHome,
}) => {
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const serverUrl = import.meta.env.VITE_MEDIASOUP_SERVER_URL || "";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = normalizeTabletCode(e.target.value).slice(0, 9);
    setCode(formatTabletCode(raw));
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = normalizeTabletCode(code);
    if (cleanCode.length !== 9) {
      toast.error("Please enter the complete 9-digit pairing code");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch(`${serverUrl}/api/pair/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to verify pairing code");
      }

      toast.success("Tablet companion paired! Entering whiteboard mode...");
      onPaired({
        classId: data.classId,
        token: data.token,
        isPenDevice: true,
      });
    } catch (err: any) {
      toast.error(err.message || "Connection failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col justify-between p-6 sm:p-12 relative overflow-hidden">
      {/* Background radial highlight */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#f59e0b]/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#f59e0b]/10 border border-[#f59e0b]/20 flex items-center justify-center text-[#f59e0b]">
            <Tablet className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-serif text-lg font-bold text-[#f3eee6]">Mathsy Companion</h1>
            <p className="text-[11px] text-[#a39e94]">Stylus & Whiteboard Companion Device</p>
          </div>
        </div>
        <Button
          variant="ghost"
          onClick={onBackToHome}
          className="text-xs text-[#a39e94] hover:text-[#f3eee6]"
        >
          Back
        </Button>
      </header>

      {/* Main Form */}
      <main className="max-w-md w-full mx-auto my-auto z-10 space-y-6 text-center">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] text-xs font-semibold">
            <PenTool className="w-3.5 h-3.5" />
            <span>Dedicated Pen Device Mode</span>
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl font-normal text-[#f3eee6]">
            Pair Your Stylus Tablet
          </h2>
          <p className="text-xs text-[#a39e94] leading-relaxed max-w-sm mx-auto">
            Enter the 9-digit code displayed in your Mathsy tutor meeting to connect this tablet directly to the classroom whiteboard.
          </p>
        </div>

        <form onSubmit={handleConnect} className="bg-[#1a1814] border border-[#f3eee6]/15 rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl">
          <div className="space-y-2 text-left">
            <label className="text-xs font-semibold text-[#f3eee6] tracking-wide block text-center">
              9-DIGIT CLASSROOM PAIRING CODE
            </label>
            <Input
              type="text"
              value={code}
              onChange={handleChange}
              placeholder="XXX-XXX-XXX"
              maxLength={11}
              autoFocus
              className="h-14 text-center font-mono text-2xl tracking-widest uppercase bg-[#0e0d0b] border-[#f3eee6]/20 focus:border-[#f59e0b] text-[#f59e0b] rounded-2xl placeholder:text-zinc-700 shadow-inner"
            />
            <p className="text-[10px] text-[#a39e94] text-center">
              Code expires 15 minutes after generation and can be used once.
            </p>
          </div>

          <Button
            type="submit"
            disabled={isSubmitting || normalizeTabletCode(code).length !== 9}
            className="w-full h-12 bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-sm rounded-xl gap-2 shadow-lg shadow-[#f59e0b]/20 transition disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Connecting Companion...
              </>
            ) : (
              <>
                Connect & Draw on Whiteboard
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>

          <div className="pt-3 border-t border-[#f3eee6]/10 flex items-center justify-center gap-2 text-[11px] text-[#a39e94]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Silent companion: Mic, camera, and speakers remain off.</span>
          </div>
        </form>
      </main>

      {/* Footer */}
      <footer className="text-center text-[11px] text-[#78716c] z-10">
        Mathsy Meet Pen Companion • Built for iPad, Android tablets & stylus monitors
      </footer>
    </div>
  );
};
