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
import { Video, VideoOff, Loader2 } from "lucide-react";
import { VideoTrackPlayer } from "./VideoTrackPlayer";

interface PreJoinCameraGateProps {
  open: boolean;
  localVideoTrack: MediaStreamTrack | null;
  joinPendingApproval: boolean;
  onTurnOnCamera: () => void;
  onRequestCameraOff: () => void;
  onCancel: () => void;
}

export const PreJoinCameraGateModal: React.FC<PreJoinCameraGateProps> = ({
  open,
  localVideoTrack,
  joinPendingApproval,
  onTurnOnCamera,
  onRequestCameraOff,
  onCancel,
}) => {
  return (
    <Dialog open={open}>
      <DialogContent
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-md bg-[#1a1814] border-[#f3eee6]/15 text-[#f3eee6] shadow-2xl rounded-2xl p-6 z-[99999]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl font-normal text-[#f3eee6]">
            <Video className="w-5 h-5 text-[#f59e0b]" />
            Camera Required to Enter Class
          </DialogTitle>
          <DialogDescription className="text-[#a39e94] text-xs mt-1">
            To maintain discipline and active engagement, your camera must be turned ON to enter this live classroom.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3">
          <div className="w-full aspect-video bg-[#0e0d0b] border border-[#f3eee6]/10 rounded-xl flex flex-col items-center justify-center text-[#a39e94] overflow-hidden relative">
            {localVideoTrack ? (
              <VideoTrackPlayer
                track={localVideoTrack}
                mirror={true}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <VideoOff className="w-8 h-8 opacity-40 text-red-400" />
                <span className="text-xs font-semibold text-[#a39e94]">Camera is currently OFF</span>
              </div>
            )}
          </div>

          {joinPendingApproval && (
            <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-xl p-3 flex items-center gap-2 text-xs text-[#f59e0b] animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-[#f59e0b]" />
              <span>Waiting for tutor to approve camera-off entry permission...</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button
            onClick={onTurnOnCamera}
            className="w-full bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold gap-2 rounded-xl text-xs"
          >
            <Video className="w-4 h-4" />
            Turn On Camera & Enter Class
          </Button>

          <Button
            variant="outline"
            disabled={joinPendingApproval}
            onClick={onRequestCameraOff}
            className="w-full border-[#f3eee6]/15 bg-[#221f1a] hover:bg-[#28251f] text-[#f59e0b] font-medium text-xs rounded-xl"
          >
            Request Host Permission to Join with Camera OFF
          </Button>

          <Button
            variant="ghost"
            onClick={onCancel}
            className="w-full text-[#a39e94] hover:text-[#f3eee6] text-xs"
          >
            Cancel & Exit to Lobby
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface InClassCameraWarningProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKeepCameraOn: () => void;
  onRequestExemption: () => void;
  onTurnOffAndLeave: () => void;
}

export const InClassCameraOffWarningModal: React.FC<InClassCameraWarningProps> = ({
  open,
  onOpenChange,
  onKeepCameraOn,
  onRequestExemption,
  onTurnOffAndLeave,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md bg-[#1a1814] border-[#f3eee6]/15 text-[#f3eee6] shadow-2xl rounded-2xl p-6 z-[99999]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl font-normal text-red-400">
            <VideoOff className="w-5 h-5 text-red-400" />
            Warning: Camera Required
          </DialogTitle>
          <DialogDescription className="text-[#a39e94] text-xs mt-1">
            Turning off your camera is not allowed in live classes. If you turn off your camera without host permission, you will be removed from the session.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col sm:flex-col gap-2 mt-4">
          <Button
            onClick={onKeepCameraOn}
            className="w-full bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold rounded-xl text-xs"
          >
            Keep Camera ON
          </Button>

          <Button
            variant="outline"
            onClick={onRequestExemption}
            className="w-full border-[#f3eee6]/15 bg-[#221f1a] hover:bg-[#28251f] text-[#f59e0b] font-medium text-xs rounded-xl"
          >
            Request Camera Off Exemption from Host
          </Button>

          <Button
            variant="destructive"
            onClick={onTurnOffAndLeave}
            className="w-full bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-xs rounded-xl"
          >
            Turn Off Camera & Leave Class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
