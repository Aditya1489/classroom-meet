import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Tablet, Copy, Check } from "lucide-react";
import { formatTabletCode } from "../../utils/tabletCode";
import { toast } from "sonner";

interface TabletPairingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabletCode: string;
}

export const TabletPairingModal: React.FC<TabletPairingModalProps> = ({
  open,
  onOpenChange,
  tabletCode,
}) => {
  const [copied, setCopied] = useState(false);
  const formattedCode = formatTabletCode(tabletCode);

  const handleCopy = () => {
    navigator.clipboard.writeText(formattedCode);
    setCopied(true);
    toast.success("Tablet code copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
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
            Open Mathsy on your iPad or stylus tablet and enter this 9-digit code to write silently on the live whiteboard:
          </DialogDescription>
        </DialogHeader>

        <div className="bg-[#0e0d0b] border-2 border-[#f59e0b]/40 rounded-2xl p-6 text-center space-y-3 shadow-inner my-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#a39e94]">
            Classroom Pairing Code
          </div>
          <div className="font-mono text-3xl font-extrabold text-[#f59e0b] tracking-widest select-all">
            {formattedCode}
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-2">
          <Button
            variant="outline"
            className="w-full bg-[#221f1a] hover:bg-[#28251f] border-[#f3eee6]/15 text-[#f3eee6] font-bold gap-2 rounded-xl text-xs"
            onClick={handleCopy}
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy Code"}
          </Button>
          <Button
            className="w-full bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold rounded-xl text-xs"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
