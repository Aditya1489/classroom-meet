import React, { useState, useRef, useEffect } from "react";
import { ChatMessage } from "../../engine/mediasoupClient";
import { MessageSquare, Send, X, ShieldCheck } from "lucide-react";

interface ChatDrawerProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onClose: () => void;
  currentUserId?: string;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  messages,
  onSendMessage,
  onClose,
  currentUserId,
}) => {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  return (
    <div className="flex flex-col h-full bg-[#202124] text-white border-l border-white/10 w-80 md:w-96 shrink-0 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#1a73e8]/20 text-[#8ab4f8]">
            <MessageSquare className="w-4 h-4" />
          </div>
          <h2 className="font-semibold text-sm">In-call Messages</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-white rounded-full hover:bg-white/10 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages banner */}
      <div className="bg-[#292a2d] px-4 py-2 text-[11px] text-gray-300 border-b border-white/5">
        Messages can only be seen by people in the call and are deleted when the call ends.
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-gray-400">
            <MessageSquare className="w-8 h-8 stroke-1 text-gray-500 mb-2" />
            <p className="text-sm font-medium">No messages yet</p>
            <p className="text-xs text-gray-500 max-w-xs mt-1">
              Send a note, link, or question to everyone in the meeting.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-gray-200">{msg.senderName}</span>
                {msg.isHost && (
                  <span className="flex items-center gap-0.5 text-[10px] bg-[#1a73e8]/20 text-[#8ab4f8] px-1.5 py-0.2 rounded font-medium">
                    <ShieldCheck className="w-3 h-3" /> Host
                  </span>
                )}
                <span className="text-[10px] text-gray-500">{msg.timestamp}</span>
              </div>
              <div className="bg-[#2d2f34] text-gray-100 text-xs px-3 py-2 rounded-xl rounded-tl-sm max-w-[90%] break-words">
                {msg.text}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-white/10 bg-[#1c1d20]">
        <div className="flex items-center gap-2 bg-[#2d2f34] rounded-full px-4 py-1.5 border border-white/10 focus-within:border-[#1a73e8]">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Send a message to everyone"
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-1.5 text-[#8ab4f8] hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
};
