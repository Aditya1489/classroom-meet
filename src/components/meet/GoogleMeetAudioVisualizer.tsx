import React, { useEffect, useState } from "react";
import { VolumeX } from "lucide-react";

interface GoogleMeetAudioVisualizerProps {
  track?: MediaStreamTrack | null;
  isMuted?: boolean;
}

export const GoogleMeetAudioVisualizer: React.FC<GoogleMeetAudioVisualizerProps> = ({
  track,
  isMuted = false,
}) => {
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    if (!track || track.readyState !== "live" || isMuted) {
      setVolume(0);
      return;
    }

    let animationFrameId: number;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 32;
        analyser.smoothingTimeConstant = 0.4;

        const stream = new MediaStream([track]);
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateVolume = () => {
          if (!analyser) return;
          analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = dataArray.length > 0 ? sum / dataArray.length : 0;
          const norm = Math.min(1, Math.max(0, avg / 90));
          setVolume(norm);

          animationFrameId = requestAnimationFrame(updateVolume);
        };

        updateVolume();
      }
    } catch (e) {
      console.warn("[GoogleMeetAudioVisualizer] AudioContext note:", e);
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (source) {
        try {
          source.disconnect();
        } catch {}
      }
      if (audioCtx && audioCtx.state !== "closed") {
        try {
          audioCtx.close();
        } catch {}
      }
    };
  }, [track, isMuted]);

  if (!track || track.readyState !== "live" || isMuted) {
    return (
      <span title="Microphone Muted" className="inline-flex items-center">
        <VolumeX className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
      </span>
    );
  }

  // Google Meet 3-bar vertical equalizer visualizer (bars grow/shrink based on live audio volume)
  const minH = 3; // min height in px
  const maxH = 13; // max height in px

  const h1 = Math.round(minH + (maxH - minH) * Math.min(1, volume * 1.3));
  const h2 = Math.round(minH + (maxH - minH) * Math.min(1, volume * 1.7));
  const h3 = Math.round(minH + (maxH - minH) * Math.min(1, volume * 1.1));

  const isSpeaking = volume > 0.04;

  return (
    <div
      className="flex items-center gap-[2px] h-4 px-1 shrink-0"
      title={isSpeaking ? "Speaking" : "Microphone Active"}
    >
      <span
        className={`w-[2.5px] rounded-full transition-all duration-75 ${
          isSpeaking
            ? "bg-emerald-400 shadow-sm shadow-emerald-400/60"
            : "bg-emerald-500/40"
        }`}
        style={{ height: `${h1}px` }}
      />
      <span
        className={`w-[2.5px] rounded-full transition-all duration-75 ${
          isSpeaking
            ? "bg-emerald-400 shadow-sm shadow-emerald-400/60"
            : "bg-emerald-500/40"
        }`}
        style={{ height: `${h2}px` }}
      />
      <span
        className={`w-[2.5px] rounded-full transition-all duration-75 ${
          isSpeaking
            ? "bg-emerald-400 shadow-sm shadow-emerald-400/60"
            : "bg-emerald-500/40"
        }`}
        style={{ height: `${h3}px` }}
      />
    </div>
  );
};
