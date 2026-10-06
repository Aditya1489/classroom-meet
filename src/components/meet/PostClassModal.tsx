import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { FileText, Download, CheckCircle, PhoneOff } from "lucide-react";
import { toast } from "sonner";

interface PostClassModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingCode: string;
  durationFormatted: string;
  onComplete: () => void;
}

export const PostClassModal: React.FC<PostClassModalProps> = ({
  open,
  onOpenChange,
  meetingCode,
  durationFormatted,
  onComplete,
}) => {
  const handleExportNotes = () => {
    toast.success("Whiteboard geometry notes and diagrams exported as PDF!");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-[#1a1814] text-[#f3eee6] border-[#f3eee6]/15 p-6 rounded-2xl shadow-2xl">
        <DialogHeader className="space-y-2 text-center sm:text-left">
          <div className="w-12 h-12 rounded-2xl bg-[#f59e0b]/10 border border-[#f59e0b]/20 flex items-center justify-center text-[#f59e0b] mb-1">
            <CheckCircle className="w-6 h-6" />
          </div>
          <DialogTitle className="font-serif text-2xl font-normal text-[#f3eee6]">
            Class Ended Successfully
          </DialogTitle>
          <DialogDescription className="text-[#a39e94] text-xs">
            Meeting room <span className="font-mono text-[#f59e0b]">{meetingCode}</span> has been concluded. Total duration: <span className="font-mono font-semibold text-[#f3eee6]">{durationFormatted}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-2xl p-4 space-y-3 my-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b]">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-[#f3eee6]">Classroom Whiteboard Notes</h4>
                <p className="text-[11px] text-[#a39e94]">All geometry shapes, ruler measurements, and diagrams</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportNotes}
              className="text-xs font-semibold border-[#f3eee6]/15 bg-[#221f1a] hover:bg-[#28251f] text-[#f3eee6] gap-1.5 rounded-xl"
            >
              <Download className="w-3.5 h-3.5" />
              Export PDF
            </Button>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-2">
          <Button
            className="w-full bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold gap-2 rounded-xl text-xs"
            onClick={onComplete}
          >
            <PhoneOff className="w-4 h-4" />
            Finish & Exit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
