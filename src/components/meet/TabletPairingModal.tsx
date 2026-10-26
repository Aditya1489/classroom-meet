import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Tablet, Copy, Check, Clock, ExternalLink, Loader2 } from "lucide-react";
import { formatTabletCode } from "../../utils/tabletCode";
import { toast } from "sonner";

interface TabletPairingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabletCode: string;
  classId?: string;
}

export const TabletPairingModal: React.FC<TabletPairingModalProps> = ({
  open,
  onOpenChange,
  tabletCode,
  classId,
}) => {
  const [activeCode, setActiveCode] = useState(tabletCode);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [remainingMinutes, setRemainingMinutes] = useState(15);

  const serverUrl = import.meta.env.VITE_MEDIASOUP_SERVER_URL || "";

  // Request fresh server-backed pairing code when modal opens
  useEffect(() => {
    if (open && classId) {
      setIsLoading(true);
      fetch(`${serverUrl}/api/pair/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.code) {
            setActiveCode(data.code);
            setRemainingMinutes(15);
          }
        })
        .catch((err) => {
          console.warn("[TabletPairing] Server pair create error:", err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, classId]);

  const formattedCode = formatTabletCode(activeCode || tabletCode);
  const pairUrl = `${window.location.origin}/pair`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(formattedCode);
    setCopied(true);
    toast.success("Tablet code copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(pairUrl);
    setCopiedLink(true);
    toast.success("Pairing page link copied!");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#1a1814] text-[#f3eee6] border-[#f3eee6]/15 p-6 rounded-2xl shadow-2xl">
        <DialogHeader className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[#f59e0b]/10 border border-[#f59e0b]/20 flex items-center justify-center mx-auto text-[#f59e0b]">
            <Tablet className="w-6 h-6" />
          </div>
          <DialogTitle className="font-serif text-2xl font-normal text-[#f3eee6] text-center">
            Pair Tablet Companion
          </DialogTitle>
          <DialogDescription className="text-[#a39e94] text-xs leading-relaxed text-center">
            Open <span className="text-[#f59e0b] font-mono">{pairUrl}</span> on your iPad or stylus tablet and enter this code to draw silently on the live whiteboard:
          </DialogDescription>
        </DialogHeader>

        <div className="bg-[#0e0d0b] border-2 border-[#f59e0b]/40 rounded-2xl p-6 text-center space-y-2 shadow-inner my-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#a39e94]">
            Classroom Pairing Code
          </div>
          <div className="font-mono text-3xl font-extrabold text-[#f59e0b] tracking-widest select-all flex items-center justify-center gap-2">
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-[#f59e0b]" />
            ) : (
              formattedCode
            )}
          </div>
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#a39e94]">
            <Clock className="w-3 h-3 text-[#f59e0b]" />
            <span>Valid for 15 minutes • Single use</span>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-2">
          <Button
            variant="outline"
            className="w-full bg-[#221f1a] hover:bg-[#28251f] border-[#f3eee6]/15 text-[#f3eee6] font-bold gap-2 rounded-xl text-xs"
            onClick={handleCopyCode}
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied Code" : "Copy Code"}
          </Button>

          <Button
            variant="outline"
            className="w-full bg-[#221f1a] hover:bg-[#28251f] border-[#f3eee6]/15 text-[#f3eee6] font-bold gap-2 rounded-xl text-xs"
            onClick={handleCopyLink}
          >
            {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <ExternalLink className="w-4 h-4" />}
            {copiedLink ? "Copied Link" : "Copy /pair Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
