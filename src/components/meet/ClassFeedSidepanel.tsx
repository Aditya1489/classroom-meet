import React, { useState, useRef, useEffect } from "react";
import {
  MessageSquare,
  BarChart2,
  Users,
  X,
  Pin,
  Lock,
  Unlock,
  Send,
  Plus,
  Trash2,
  Trophy,
  Clock,
  Shield,
  Hand,
  MicOff,
  LogOut,
  Video,
  VideoOff,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { Button } from "../ui/button";
import { GoogleMeetAudioVisualizer } from "./GoogleMeetAudioVisualizer";
import { VideoTrackPlayer } from "./VideoTrackPlayer";
import { toast } from "sonner";

export interface ChatMsg {
  id: string;
  senderId: string;
  senderName: string;
  message: string;
  timestamp: string;
  isHost?: boolean;
}

export interface PollItem {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex?: number | null;
  pollType?: "mcq" | "multi_correct" | "subjective";
  timerSeconds?: number | null;
  isActive: boolean;
  votes: Record<number, number>;
  totalVotes: number;
  voters: {
    userId: string;
    userName: string;
    optionIndex?: number;
    timestamp: number;
    isCorrect?: boolean;
  }[];
}

interface ClassFeedSidepanelProps {
  isOpen: boolean;
  activeTab: "chat" | "polls" | "participants";
  onTabChange: (tab: "chat" | "polls" | "participants") => void;
  onClose: () => void;
  isHost: boolean;
  currentUserId: string;
  currentUserName: string;
  meetingCode: string;
  // Chat props
  chatMessages: ChatMsg[];
  onSendMessage: (text: string) => void;
  isChatLocked: boolean;
  onToggleChatLock: () => void;
  pinnedMessage: { text: string; senderName: string } | null;
  onPinMessage: (text: string) => void;
  onUnpinMessage: () => void;
  // Polls props
  activePoll: PollItem | null;
  onLaunchPoll: (poll: {
    question: string;
    options: string[];
    pollType: "mcq" | "multi_correct" | "subjective";
    correctOptionIndex?: number | null;
    timerSeconds?: number | null;
  }) => void;
  onVotePoll: (optionIndex: number) => void;
  onEndPoll: () => void;
  onDismissLeaderboard: () => void;
  hasVoted: boolean;
  // Participants props
  participants: Array<{
    id: string;
    name: string;
    role: string;
    audioTrack?: MediaStreamTrack | null;
    videoTrack?: MediaStreamTrack | null;
    isAudioMuted?: boolean;
    isVideoMuted?: boolean;
    isHandRaised?: boolean;
  }>;
  onLowerHand: (userId: string) => void;
  onLowerAllHands: () => void;
  onForceMuteStudent: (userId: string, name: string) => void;
  onMuteAllStudents: () => void;
  onExpelStudent: (userId: string, name: string) => void;
}

export const ClassFeedSidepanel: React.FC<ClassFeedSidepanelProps> = ({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  isHost,
  currentUserId,
  currentUserName,
  meetingCode,
  chatMessages,
  onSendMessage,
  isChatLocked,
  onToggleChatLock,
  pinnedMessage,
  onPinMessage,
  onUnpinMessage,
  activePoll,
  onLaunchPoll,
  onVotePoll,
  onEndPoll,
  onDismissLeaderboard,
  hasVoted,
  participants,
  onLowerHand,
  onLowerAllHands,
  onForceMuteStudent,
  onMuteAllStudents,
  onExpelStudent,
}) => {
  // Chat Input State
  const [inputText, setInputText] = useState("");
  const [pinInputText, setPinInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Poll Creator State
  const [showCreatePoll, setShowCreatePoll] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [newOptions, setNewOptions] = useState<string[]>(["", ""]);
  const [newPollType, setNewPollType] = useState<"mcq" | "multi_correct" | "subjective">("mcq");
  const [newCorrectOption, setNewCorrectOption] = useState<number | null>(null);
  const [newTimer, setNewTimer] = useState<number | null>(30);
  const [selectedVoteIndex, setSelectedVoteIndex] = useState<number | null>(null);

  // Auto scroll chat to bottom
  useEffect(() => {
    if (activeTab === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, activeTab]);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    if (!isHost && isChatLocked) {
      toast.error("Chat is locked by host");
      return;
    }
    onSendMessage(inputText.trim());
    setInputText("");
  };

  const handleAddOption = () => {
    if (newOptions.length < 6) {
      setNewOptions([...newOptions, ""]);
    }
  };

  const handleRemoveOption = (index: number) => {
    if (newOptions.length > 2) {
      const updated = newOptions.filter((_, i) => i !== index);
      setNewOptions(updated);
      if (newCorrectOption === index) setNewCorrectOption(null);
    }
  };

  const handleCreatePollSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestion.trim()) {
      toast.error("Please enter a question");
      return;
    }
    const filteredOptions = newOptions.map((o) => o.trim()).filter(Boolean);
    if (newPollType !== "subjective" && filteredOptions.length < 2) {
      toast.error("Please provide at least 2 options");
      return;
    }

    onLaunchPoll({
      question: newQuestion.trim(),
      options: newPollType === "subjective" ? [] : filteredOptions,
      pollType: newPollType,
      correctOptionIndex: newCorrectOption,
      timerSeconds: newTimer,
    });

    setNewQuestion("");
    setNewOptions(["", ""]);
    setNewCorrectOption(null);
    setShowCreatePoll(false);
    toast.success("Poll launched to class!");
  };

  const copyInviteLink = () => {
    const url = `${window.location.origin}/meet/${meetingCode}`;
    navigator.clipboard.writeText(url);
    toast.success("Meeting link copied to clipboard!");
  };

  return (
    <aside className="w-80 md:w-96 h-full bg-[#1a1814] border-l border-[#f3eee6]/[0.08] flex flex-col z-30 shadow-2xl shrink-0 overflow-hidden font-sans">
      {/* ── Top Tabs Header ── */}
      <div className="h-14 border-b border-[#f3eee6]/[0.08] flex items-center bg-[#16130f] px-2 shrink-0">
        <button
          onClick={() => onTabChange("chat")}
          className={`flex-1 py-3 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "chat"
              ? "border-[#f59e0b] text-[#f59e0b] bg-[#f59e0b]/5"
              : "border-transparent text-[#a39e94] hover:text-[#f3eee6]"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
        </button>

        <button
          onClick={() => onTabChange("polls")}
          className={`flex-1 py-3 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "polls"
              ? "border-[#f59e0b] text-[#f59e0b] bg-[#f59e0b]/5"
              : "border-transparent text-[#a39e94] hover:text-[#f3eee6]"
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          Polls
          {activePoll?.isActive && (
            <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse ml-0.5" />
          )}
        </button>

        <button
          onClick={() => onTabChange("participants")}
          className={`flex-1 py-3 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "participants"
              ? "border-[#f59e0b] text-[#f59e0b] bg-[#f59e0b]/5"
              : "border-transparent text-[#a39e94] hover:text-[#f3eee6]"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Users ({participants.length})
        </button>

        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 text-[#a39e94] hover:text-[#f3eee6] rounded-lg ml-1 transition"
          title="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── TAB 1: CHAT ── */}
      {activeTab === "chat" && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Pinned Message Banner */}
          {pinnedMessage && (
            <div className="bg-yellow-500/10 border-b border-yellow-500/20 p-3 flex gap-2 text-xs shrink-0 select-text animate-in slide-in-from-top duration-200">
              <Pin className="w-3.5 h-3.5 text-yellow-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-bold text-yellow-500 block text-[9px] uppercase tracking-wider mb-0.5">
                  Pinned Message • {pinnedMessage.senderName}
                </span>
                <p className="text-zinc-200 break-words leading-relaxed text-[11px]">
                  {pinnedMessage.text}
                </p>
              </div>
              {isHost && (
                <button
                  onClick={onUnpinMessage}
                  className="text-zinc-400 hover:text-white shrink-0 p-1 hover:bg-white/5 rounded"
                  title="Unpin Message"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Host Pin Bar & Chat Lock Toggle */}
          {isHost && (
            <div className="bg-black/20 border-b border-white/5 p-2 flex items-center gap-1.5 shrink-0">
              <input
                type="text"
                value={pinInputText}
                onChange={(e) => setPinInputText(e.target.value)}
                placeholder="Pin a link or notice..."
                className="flex-1 min-w-0 bg-zinc-950 border border-white/10 rounded px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-yellow-500/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pinInputText.trim()) {
                    e.preventDefault();
                    onPinMessage(pinInputText.trim());
                    setPinInputText("");
                  }
                }}
              />
              <Button
                size="sm"
                onClick={() => {
                  if (pinInputText.trim()) {
                    onPinMessage(pinInputText.trim());
                    setPinInputText("");
                  }
                }}
                disabled={!pinInputText.trim()}
                className="h-7 px-2.5 bg-yellow-500 hover:bg-yellow-600 text-black font-bold text-[10px] rounded shrink-0"
              >
                Pin
              </Button>
              <button
                onClick={onToggleChatLock}
                className={`h-7 px-2.5 rounded font-bold text-[10px] flex items-center gap-1 transition-all border shrink-0 ${
                  isChatLocked
                    ? "bg-red-500/20 text-red-400 border-red-500/40 hover:bg-red-500/30"
                    : "bg-zinc-800 text-zinc-300 border-white/10 hover:bg-zinc-700 hover:text-white"
                }`}
                title={isChatLocked ? "Unlock Chat for Students" : "Lock Chat for Students"}
              >
                {isChatLocked ? <Lock className="w-3 h-3 text-red-400" /> : <Unlock className="w-3 h-3" />}
                <span>{isChatLocked ? "Locked" : "Lock"}</span>
              </button>
            </div>
          )}

          {/* Message Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-xs text-center p-6">
                <MessageSquare className="w-10 h-10 mb-2 opacity-30 text-zinc-400" />
                <p className="font-semibold text-zinc-400">No messages yet</p>
                <p className="text-[11px] text-zinc-500 mt-1">Send a message to everyone in the room.</p>
              </div>
            ) : (
              chatMessages.map((msg) => {
                const isMe = msg.senderId === currentUserId;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                  >
                    <span className="text-[10px] text-zinc-400 mb-0.5 px-1 flex items-center gap-1 font-medium font-mono">
                      {isMe ? "You" : msg.senderName}
                      {msg.isHost && (
                        <span className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1 rounded text-[9px] font-bold">
                          Host
                        </span>
                      )}
                      <span className="text-[9px] text-zinc-500">{msg.timestamp}</span>
                      {isHost && (
                        <button
                          onClick={() => onPinMessage(msg.message)}
                          className="text-zinc-500 hover:text-yellow-400 transition-colors p-0.5 ml-1 inline-flex items-center"
                          title="Pin this message"
                        >
                          <Pin className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </span>

                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs break-words shadow-md leading-relaxed ${
                        isMe
                          ? "bg-[#1a73e8] text-white rounded-tr-none"
                          : msg.isHost
                          ? "bg-yellow-500/10 text-white border border-yellow-500/20 rounded-tl-none font-medium"
                          : "bg-zinc-800 text-zinc-100 rounded-tl-none"
                      }`}
                    >
                      <p>{msg.message}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Bar */}
          <div className="p-3 border-t border-white/10 bg-[#18191c]">
            {!isHost && isChatLocked ? (
              <div className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                <Lock className="w-3.5 h-3.5" />
                <span>Chat is locked by host</span>
              </div>
            ) : (
              <form onSubmit={handleSend} className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Send a message to everyone..."
                  className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#1a73e8]"
                />
                <Button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="h-9 px-3 rounded-xl bg-[#1a73e8] hover:bg-[#1557b0] text-white shrink-0"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: POLLS ── */}
      {activeTab === "polls" && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 space-y-4">
          {/* Host: Create Poll Button */}
          {isHost && !showCreatePoll && (
            <Button
              onClick={() => setShowCreatePoll(true)}
              className="w-full bg-[#1a73e8] hover:bg-[#1557b0] text-white font-bold text-xs gap-1.5 rounded-xl py-2.5"
            >
              <Plus className="w-4 h-4" />
              Create Live Poll
            </Button>
          )}

          {/* Host: Poll Creator Form */}
          {isHost && showCreatePoll && (
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-4 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  New Classroom Poll
                </h3>
                <button
                  onClick={() => setShowCreatePoll(false)}
                  className="p-1 text-zinc-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 block mb-1">
                  Question
                </label>
                <textarea
                  rows={2}
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="Type your question..."
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-[#1a73e8]"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 block mb-1">
                  Poll Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewPollType("mcq")}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition ${
                      newPollType === "mcq"
                        ? "bg-[#1a73e8]/20 border-[#1a73e8] text-[#8ab4f8]"
                        : "bg-zinc-950 border-white/10 text-zinc-400"
                    }`}
                  >
                    Single Choice
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewPollType("multi_correct")}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition ${
                      newPollType === "multi_correct"
                        ? "bg-[#1a73e8]/20 border-[#1a73e8] text-[#8ab4f8]"
                        : "bg-zinc-950 border-white/10 text-zinc-400"
                    }`}
                  >
                    Multi Choice
                  </button>
                </div>
              </div>

              {newPollType !== "subjective" && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-400 block">
                    Options & Correct Answer
                  </label>
                  {newOptions.map((opt, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setNewCorrectOption(newCorrectOption === i ? null : i)}
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border ${
                          newCorrectOption === i
                            ? "bg-emerald-500 border-emerald-400 text-black"
                            : "border-white/20 text-zinc-500 hover:text-white"
                        }`}
                        title="Mark as correct answer"
                      >
                        {String.fromCharCode(65 + i)}
                      </button>
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const updated = [...newOptions];
                          updated[i] = e.target.value;
                          setNewOptions(updated);
                        }}
                        placeholder={`Option ${i + 1}`}
                        className="flex-1 bg-zinc-950 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#1a73e8]"
                      />
                      {newOptions.length > 2 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveOption(i)}
                          className="p-1 text-zinc-500 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {newOptions.length < 6 && (
                    <button
                      type="button"
                      onClick={handleAddOption}
                      className="text-xs text-[#8ab4f8] hover:underline flex items-center gap-1 mt-1 font-semibold"
                    >
                      <Plus className="w-3 h-3" /> Add Option
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleCreatePollSubmit}
                  className="flex-1 bg-[#1a73e8] hover:bg-[#1557b0] text-white font-bold text-xs rounded-xl"
                >
                  Launch Poll
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowCreatePoll(false)}
                  className="border-zinc-700 text-zinc-300 text-xs rounded-xl"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Active Poll Display */}
          {activePoll ? (
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="bg-[#1a73e8]/20 text-[#8ab4f8] border border-[#1a73e8]/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                  {activePoll.isActive ? "Live Poll" : "Poll Concluded"}
                </span>
                <span className="text-[11px] text-zinc-400 font-semibold">
                  {activePoll.totalVotes} Votes
                </span>
              </div>

              <h4 className="text-sm font-bold text-white leading-snug">
                {activePoll.question}
              </h4>

              {/* Voting Options */}
              <div className="space-y-2 pt-1">
                {activePoll.options.map((opt, idx) => {
                  const voteCount = activePoll.votes[idx] || 0;
                  const percent =
                    activePoll.totalVotes > 0
                      ? Math.round((voteCount / activePoll.totalVotes) * 100)
                      : 0;
                  const isCorrect = activePoll.correctOptionIndex === idx;

                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        if (!hasVoted && activePoll.isActive) {
                          setSelectedVoteIndex(idx);
                        }
                      }}
                      className={`relative overflow-hidden rounded-xl border p-2.5 transition cursor-pointer ${
                        selectedVoteIndex === idx
                          ? "border-[#1a73e8] bg-[#1a73e8]/10"
                          : "border-white/10 bg-zinc-950/60 hover:border-white/20"
                      }`}
                    >
                      {/* Vote Progress Bar */}
                      <div
                        className="absolute inset-y-0 left-0 bg-[#1a73e8]/20 transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />

                      <div className="relative flex items-center justify-between z-10 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-[10px] font-bold text-zinc-300">
                            {String.fromCharCode(65 + idx)}
                          </span>
                          <span className="font-medium text-white">{opt}</span>
                          {isCorrect && !activePoll.isActive && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          )}
                        </div>
                        <span className="font-bold text-zinc-300 text-[11px]">
                          {percent}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Submit Vote Button (for students) */}
              {activePoll.isActive && !hasVoted && selectedVoteIndex !== null && (
                <Button
                  onClick={() => {
                    onVotePoll(selectedVoteIndex);
                    toast.success("Vote recorded!");
                  }}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl"
                >
                  Submit Vote
                </Button>
              )}

              {hasVoted && activePoll.isActive && (
                <div className="text-center text-[11px] text-emerald-400 font-bold bg-emerald-500/10 py-1.5 rounded-lg border border-emerald-500/20">
                  Your vote has been submitted!
                </div>
              )}

              {/* Host Controls */}
              {isHost && activePoll.isActive && (
                <Button
                  onClick={onEndPoll}
                  variant="destructive"
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl"
                >
                  End Poll & Show Leaderboard
                </Button>
              )}

              {/* Real-time Leaderboard */}
              {(!activePoll.isActive || isHost) && activePoll.voters.length > 0 && (
                <div className="mt-4 pt-3 border-t border-white/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-yellow-400">
                      <Trophy className="w-4 h-4" />
                      <span>Live Poll Leaderboard</span>
                    </div>
                    {isHost && (
                      <button
                        onClick={onDismissLeaderboard}
                        className="text-[10px] text-zinc-400 hover:text-white"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {activePoll.voters.slice(0, 5).map((voter, rank) => (
                      <div
                        key={voter.userId + rank}
                        className="flex items-center justify-between p-2 rounded-lg bg-zinc-950/80 border border-white/5 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-[11px] w-5 text-center text-zinc-400">
                            {rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : `#${rank + 1}`}
                          </span>
                          <span className="font-medium text-white">{voter.userName}</span>
                        </div>
                        <span
                          className={`font-bold text-[10px] px-1.5 py-0.5 rounded ${
                            voter.isCorrect
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {voter.isCorrect ? "Correct" : "Responded"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            !showCreatePoll && (
              <div className="flex flex-col items-center justify-center h-48 text-zinc-500 text-xs text-center p-6">
                <BarChart2 className="w-10 h-10 mb-2 opacity-30 text-zinc-400" />
                <p className="font-semibold text-zinc-400">No active poll</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  {isHost ? "Click the button above to launch a live poll." : "The host hasn't launched any polls yet."}
                </p>
              </div>
            )
          )}
        </div>
      )}

      {/* ── TAB 3: USERS / PARTICIPANTS (CRM VIDEO GRID LAYOUT) ── */}
      {activeTab === "participants" && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-3.5 space-y-3">
          {/* Header Action Bar */}
          <div className="flex items-center justify-between pb-2 border-b border-white/5">
            <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-[#8ab4f8]" />
              Class Members ({participants.length})
            </span>

            <div className="flex items-center gap-1.5">
              {isHost && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onMuteAllStudents}
                  className="h-6 px-2 text-[10px] font-bold gap-1 bg-rose-600 hover:bg-rose-700 text-white rounded-md cursor-pointer"
                  title="Mute all student microphones"
                >
                  <MicOff className="w-3 h-3" /> Mute All
                </Button>
              )}
              {isHost && onLowerAllHands && (
                <Button
                  size="sm"
                  onClick={onLowerAllHands}
                  className="h-6 px-2 text-[10px] font-bold gap-1 bg-amber-500 hover:bg-amber-600 text-zinc-950 rounded-md cursor-pointer"
                  title="Lower all hands"
                >
                  <Hand className="w-3 h-3 text-zinc-950" /> Lower Hands
                </Button>
              )}
            </div>
          </div>

          {/* Quick Invite Link */}
          <button
            onClick={copyInviteLink}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold py-2 rounded-xl transition text-[#8ab4f8] cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Meeting Link</span>
          </button>

          {/* Dynamic 2-Column Video Grid for all Users (Matching CRM) */}
          <div
            className={`flex-1 overflow-y-auto grid gap-2 items-start content-start ${
              participants.length === 1 ? "grid-cols-1" : "grid-cols-2"
            }`}
          >
            {participants.map((p) => {
              const isMe = p.id === currentUserId;
              const isTutorRole = p.role === "host" || p.role === "tutor";
              const hasHandRaised = p.isHandRaised;

              return (
                <div
                  key={p.id}
                  className={`group flex flex-col p-1.5 rounded-xl border transition-all ${
                    hasHandRaised
                      ? "bg-amber-500/10 border-amber-500/50 ring-2 ring-amber-500/30"
                      : isTutorRole
                      ? "bg-[#f59e0b]/10 border-[#f59e0b]/30"
                      : "bg-[#221f1a] border-[#f3eee6]/[0.08]"
                  }`}
                >
                  {/* Top user header */}
                  <div className="flex items-center justify-between px-1 mb-1">
                    <p className="text-[10px] font-bold text-[#f3eee6] truncate flex items-center gap-1 font-mono">
                      {p.name} {isMe && "(You)"}
                      {isTutorRole && <Shield className="w-2.5 h-2.5 text-[#f59e0b] fill-[#f59e0b]/20 shrink-0" />}
                    </p>
                  </div>

                  {/* 16:9 Video Tile Box */}
                  <div className="w-full aspect-video bg-[#0e0d0b] rounded-lg overflow-hidden border border-[#f3eee6]/10 relative">
                    {/* Bottom-left audio visualizer pill */}
                    <div className="absolute bottom-1.5 left-1.5 z-20 bg-zinc-950/80 backdrop-blur-md border border-white/10 px-1.5 py-0.5 rounded-full flex items-center shadow-md">
                      <GoogleMeetAudioVisualizer track={p.audioTrack} isMuted={p.isAudioMuted} />
                    </div>

                    {/* Raised hand badge in bottom right */}
                    {hasHandRaised && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onLowerHand(p.id);
                        }}
                        className="absolute bottom-1.5 right-1.5 z-40 p-1.5 rounded-full bg-amber-500 hover:bg-amber-400 text-zinc-950 flex items-center justify-center shadow-lg active:scale-95 cursor-pointer transition-all animate-bounce border border-amber-300/50"
                        title="Hand Raised — Click to lower student's hand"
                      >
                        <Hand className="w-3.5 h-3.5 text-zinc-950" />
                      </button>
                    )}

                    {/* Center hover action overlay for Tutor (Mute & Expel) — hidden while hand is raised */}
                    {isHost && !isTutorRole && !isMe && !hasHandRaised && (
                      <div className="absolute inset-0 z-30 bg-zinc-950/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 pointer-events-none group-hover:pointer-events-auto">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onForceMuteStudent(p.id, p.name);
                          }}
                          className="p-1.5 rounded-full bg-rose-500/90 hover:bg-rose-500 text-white shadow-xl border border-rose-400/50 transition-all hover:scale-110 active:scale-95 cursor-pointer"
                          title={`Mute ${p.name}`}
                        >
                          <MicOff className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onExpelStudent(p.id, p.name);
                          }}
                          className="p-1.5 rounded-full bg-red-700/90 hover:bg-red-600 text-white shadow-xl border border-red-500/50 transition-all hover:scale-110 active:scale-95 cursor-pointer"
                          title={`Expel ${p.name}`}
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Video track or avatar fallback */}
                    {p.videoTrack && !p.isVideoMuted ? (
                      <VideoTrackPlayer
                        track={p.videoTrack}
                        mirror={isMe}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-300 relative overflow-hidden">
                        <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400 font-extrabold text-xs shadow-inner">
                          {p.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) || "U"}
                        </div>
                        {!hasHandRaised && (
                          <div
                            className="absolute bottom-1 right-1 bg-black/70 backdrop-blur-md p-1 rounded-full text-zinc-400 border border-white/10"
                            title="Camera Off"
                          >
                            <VideoOff className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};
