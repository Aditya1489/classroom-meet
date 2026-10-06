import React from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface FloatingReaction {
  id: string;
  emoji: string;
  x: number;
  userName?: string;
}

interface FloatingReactionsProps {
  reactions: FloatingReaction[];
}

export const FloatingReactionsOverlay: React.FC<FloatingReactionsProps> = ({ reactions }) => {
  return (
    <div className="absolute inset-x-0 bottom-24 top-0 pointer-events-none overflow-hidden z-40">
      <AnimatePresence>
        {reactions.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 150, x: `${r.x}vw`, scale: 0.5 }}
            animate={{
              opacity: [0, 1, 1, 0],
              y: -500,
              scale: [0.5, 1.3, 1.3, 1],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.5, ease: "easeOut" }}
            className="absolute bottom-10 flex flex-col items-center gap-1 z-40 pointer-events-none"
          >
            <span className="text-4xl drop-shadow-lg">{r.emoji}</span>
            {r.userName && (
              <span className="text-[10px] bg-black/70 backdrop-blur-md text-white px-2 py-0.5 rounded-full font-medium border border-white/10 whitespace-nowrap shadow-md">
                {r.userName}
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

interface ReactionPickerBarProps {
  onSelectReaction: (emoji: string) => void;
  onClose?: () => void;
}

export const REACTION_EMOJIS = ["❤️", "👍", "👏", "🎉", "🔥", "😂", "👎"];

export const ReactionPickerBar: React.FC<ReactionPickerBarProps> = ({
  onSelectReaction,
  onClose,
}) => {
  return (
    <div className="flex items-center gap-1.5 bg-zinc-900/95 backdrop-blur-md border border-white/15 px-3 py-2 rounded-full shadow-2xl animate-in zoom-in-95 duration-150">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => {
            onSelectReaction(emoji);
            onClose?.();
          }}
          className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center text-xl transition-transform active:scale-125 hover:scale-110"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};
