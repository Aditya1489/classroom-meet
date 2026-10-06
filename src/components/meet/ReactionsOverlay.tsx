import React, { useEffect, useState } from "react";
import { ReactionEvent } from "../../engine/mediasoupClient";

interface ReactionsOverlayProps {
  reaction: ReactionEvent | null;
}

interface FloatingItem {
  id: string;
  emoji: string;
  senderName: string;
  leftPercent: number;
}

export const ReactionsOverlay: React.FC<ReactionsOverlayProps> = ({ reaction }) => {
  const [items, setItems] = useState<FloatingItem[]>([]);

  useEffect(() => {
    if (!reaction) return;
    const newItem: FloatingItem = {
      id: Math.random().toString(),
      emoji: reaction.emoji,
      senderName: reaction.senderName,
      leftPercent: 15 + Math.random() * 70, // random horizontal offset
    };

    setItems((prev) => [...prev, newItem]);

    const timer = setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== newItem.id));
    }, 2200);

    return () => clearTimeout(timer);
  }, [reaction]);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {items.map((item) => (
        <div
          key={item.id}
          className="absolute bottom-20 flex flex-col items-center animate-float-up"
          style={{ left: `${item.leftPercent}%` }}
        >
          <span className="text-4xl filter drop-shadow-lg">{item.emoji}</span>
          <span className="text-[10px] bg-black/60 backdrop-blur-sm text-gray-200 px-2 py-0.5 rounded-full mt-1 border border-white/10">
            {item.senderName}
          </span>
        </div>
      ))}
    </div>
  );
};
