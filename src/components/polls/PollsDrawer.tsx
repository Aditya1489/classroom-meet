import React, { useState } from "react";
import { Poll } from "../../engine/mediasoupClient";
import { Plus, BarChart3, CheckCircle2, X, Sparkles, Send } from "lucide-react";
import { toast } from "sonner";

interface PollsDrawerProps {
  polls: Poll[];
  onCreatePoll: (question: string, options: string[]) => void;
  onVote: (pollId: string, optionId: string) => void;
  isHost: boolean;
  onClose: () => void;
}

export const PollsDrawer: React.FC<PollsDrawerProps> = ({
  polls,
  onCreatePoll,
  onVote,
  isHost,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<"polls" | "create">("polls");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["Option 1", "Option 2"]);

  const handleAddOption = () => {
    if (options.length >= 6) {
      toast.error("Maximum 6 options allowed per poll");
      return;
    }
    setOptions([...options, `Option ${options.length + 1}`]);
  };

  const handleRemoveOption = (index: number) => {
    if (options.length <= 2) {
      toast.error("At least 2 options are required");
      return;
    }
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleOptionChange = (index: number, val: string) => {
    const updated = [...options];
    updated[index] = val;
    setOptions(updated);
  };

  const handleSubmitPoll = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) {
      toast.error("Please enter a question");
      return;
    }
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (cleanOptions.length < 2) {
      toast.error("Please provide at least 2 non-empty options");
      return;
    }

    onCreatePoll(question.trim(), cleanOptions);
    toast.success("Poll published to meeting participants!");
    setQuestion("");
    setOptions(["Option 1", "Option 2"]);
    setActiveTab("polls");
  };

  return (
    <div className="flex flex-col h-full bg-[#202124] text-white border-l border-white/10 w-80 md:w-96 shrink-0 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#1a73e8]/20 text-[#8ab4f8]">
            <BarChart3 className="w-4 h-4" />
          </div>
          <h2 className="font-semibold text-sm">Activities & Polls</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-white rounded-full hover:bg-white/10 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 bg-[#1c1d20] px-4 pt-2 gap-4">
        <button
          onClick={() => setActiveTab("polls")}
          className={`pb-2 text-xs font-semibold uppercase tracking-wider transition border-b-2 ${
            activeTab === "polls"
              ? "border-[#1a73e8] text-[#8ab4f8]"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
        >
          Active Polls ({polls.length})
        </button>
        {isHost && (
          <button
            onClick={() => setActiveTab("create")}
            className={`pb-2 text-xs font-semibold uppercase tracking-wider transition border-b-2 flex items-center gap-1 ${
              activeTab === "create"
                ? "border-[#1a73e8] text-[#8ab4f8]"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            Create Poll
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === "create" ? (
          <form onSubmit={handleSubmitPoll} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">
                Poll Question
              </label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g., What is the derivative of sin(x)?"
                rows={3}
                className="w-full bg-[#2d2f34] border border-white/10 rounded-xl p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1a73e8]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">
                Answer Options
              </label>
              <div className="space-y-2">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => handleOptionChange(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 bg-[#2d2f34] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#1a73e8]"
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveOption(i)}
                        className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {options.length < 6 && (
                <button
                  type="button"
                  onClick={handleAddOption}
                  className="mt-2 text-xs text-[#8ab4f8] hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add another option
                </button>
              )}
            </div>

            <button
              type="submit"
              className="w-full mt-4 flex items-center justify-center gap-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white py-2.5 rounded-xl font-medium text-sm transition shadow-lg shadow-[#1a73e8]/20"
            >
              <Send className="w-4 h-4" />
              Launch Poll
            </button>
          </form>
        ) : polls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-gray-400">
            <BarChart3 className="w-10 h-10 stroke-1 text-gray-500 mb-2" />
            <p className="text-sm font-medium">No polls launched yet</p>
            <p className="text-xs text-gray-500 max-w-xs mt-1">
              {isHost
                ? "Click 'Create Poll' above to test your students or audience."
                : "The host has not started any live polls yet."}
            </p>
          </div>
        ) : (
          polls.map((poll) => {
            const hasVoted = Boolean(poll.userVotedId);
            return (
              <div
                key={poll.id}
                className="bg-[#282a2d] border border-white/10 rounded-2xl p-4 shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white leading-snug">
                    {poll.question}
                  </h3>
                  <span className="text-[10px] bg-white/10 text-gray-300 px-2 py-0.5 rounded-full shrink-0">
                    {poll.totalVotes} votes
                  </span>
                </div>

                <div className="space-y-2">
                  {poll.options.map((opt) => {
                    const percentage =
                      poll.totalVotes > 0
                        ? Math.round((opt.votes / poll.totalVotes) * 100)
                        : 0;
                    const isUserChoice = poll.userVotedId === opt.id;

                    return (
                      <div
                        key={opt.id}
                        onClick={() => !hasVoted && onVote(poll.id, opt.id)}
                        className={`relative overflow-hidden rounded-xl border p-2.5 transition text-xs ${
                          hasVoted
                            ? "cursor-default border-white/5 bg-[#202124]"
                            : "cursor-pointer border-white/10 hover:border-[#1a73e8] bg-[#222427] hover:bg-[#25282d]"
                        } ${isUserChoice ? "border-[#1a73e8] bg-[#1a73e8]/10" : ""}`}
                      >
                        {/* Progress bar background */}
                        {hasVoted && (
                          <div
                            className="absolute inset-y-0 left-0 bg-[#1a73e8]/30 transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        )}

                        <div className="relative flex items-center justify-between z-10">
                          <div className="flex items-center gap-2">
                            {isUserChoice && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#8ab4f8]" />
                            )}
                            <span className="font-medium text-white">{opt.text}</span>
                          </div>
                          {hasVoted && (
                            <span className="text-gray-300 font-mono">
                              {percentage}% ({opt.votes})
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="text-[11px] text-gray-500 pt-1 flex items-center justify-between">
                  <span>By {poll.creatorName}</span>
                  {hasVoted ? (
                    <span className="text-emerald-400 font-medium">Vote Recorded</span>
                  ) : (
                    <span className="text-[#8ab4f8]">Click an option to vote</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
