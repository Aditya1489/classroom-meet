import React, { useState, useEffect } from "react";
import {
  BarChart3,
  Clock,
  Users,
  Video,
  RefreshCw,
  AlertCircle,
  Calendar,
  Layers,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "../../lib/apiConfig";

interface UsageSummary {
  organizationId: string;
  totalBilledMinutes: number;
  totalParticipantSessions: number;
  totalDistinctRooms: number;
  breakdownByRole: Record<string, number>;
  timeWindow: {
    startDate: string;
    endDate: string;
  };
}

interface UsageAnalyticsTabProps {
  orgId: string;
}

type DateRangeOption = "7d" | "30d" | "90d" | "all";

export const UsageAnalyticsTab: React.FC<UsageAnalyticsTabProps> = ({ orgId }) => {
  const [range, setRange] = useState<DateRangeOption>("30d");
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = localStorage.getItem("mathsy_meet_token");
  const getHeaders = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const calculateDateRange = (opt: DateRangeOption) => {
    const now = new Date();
    let startDate: string | undefined;
    const endDate = now.toISOString();

    if (opt === "7d") {
      startDate = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    } else if (opt === "30d") {
      startDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    } else if (opt === "90d") {
      startDate = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    } else if (opt === "all") {
      startDate = new Date(2025, 0, 1).toISOString();
    }

    return { startDate, endDate };
  };

  const fetchUsage = async () => {
    try {
      setLoading(true);
      setError(null);
      const { startDate, endDate } = calculateDateRange(range);
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.set("startDate", startDate);
      if (endDate) queryParams.set("endDate", endDate);

      const res = await fetch(`${API_BASE}/organizations/${orgId}/usage?${queryParams.toString()}`, {
        headers: getHeaders(),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load usage data from server");
      }

      const data = await res.json();
      setUsage(data.usage || null);
    } catch (err: any) {
      console.error("Usage fetch error:", err);
      setError(err.message || "Failed to load usage summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, [orgId, range]);

  const totalMinutes = usage?.totalBilledMinutes ?? 0;
  const totalSessions = usage?.totalParticipantSessions ?? 0;
  const totalRooms = usage?.totalDistinctRooms ?? 0;
  const breakdown = usage?.breakdownByRole || {};
  const roles = Object.keys(breakdown);

  const formatHours = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  };

  return (
    <div className="space-y-6">
      {/* Header with Date Range Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-[#f3eee6]">Usage & Metering Ledger</h2>
          <p className="text-xs text-[#a39e94]">
            Auditable participant-minute metering records verified by the SFU media router
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Range pills */}
          <div className="flex items-center gap-1 bg-[#0a0907] border border-[#f3eee6]/10 p-1 rounded-xl">
            {(
              [
                { id: "7d", label: "Last 7 Days" },
                { id: "30d", label: "Last 30 Days" },
                { id: "90d", label: "Last 90 Days" },
                { id: "all", label: "All Time" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => setRange(item.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  range === item.id
                    ? "bg-[#f59e0b] text-[#0e0d0b]"
                    : "text-[#a39e94] hover:text-[#f3eee6]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            onClick={fetchUsage}
            disabled={loading}
            title="Refresh usage"
            className="p-2 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer border border-[#f3eee6]/10 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-2xl p-5 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" />
            <div>
              <h3 className="text-xs font-bold text-[#f3eee6]">Failed to Load Usage Data</h3>
              <p className="text-xs text-[#ef4444] mt-0.5">{error}</p>
            </div>
          </div>
          <button
            onClick={fetchUsage}
            className="px-3.5 py-1.5 rounded-xl bg-[#ef4444]/20 hover:bg-[#ef4444]/30 text-[#ef4444] text-xs font-semibold border border-[#ef4444]/30 transition cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-16 text-center text-[#a39e94]">
          <RefreshCw className="w-8 h-8 animate-spin text-[#f59e0b] mx-auto mb-3" />
          <p className="text-xs font-medium">Aggregating organization usage records...</p>
        </div>
      ) : !error && totalMinutes === 0 && totalSessions === 0 ? (
        /* Empty State */
        <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#f59e0b]/10 text-[#f59e0b] flex items-center justify-center mx-auto mb-3 border border-[#f59e0b]/20">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#f3eee6]">No Usage Recorded For This Period</h3>
          <p className="text-xs text-[#a39e94] max-w-md mx-auto leading-relaxed">
            As students and tutors join your Mathsy Meet video rooms, participant session minutes are recorded into the ledger in real-time.
          </p>
          {usage?.timeWindow && (
            <p className="text-[11px] text-[#a39e94]/70 font-mono">
              Window: {new Date(usage.timeWindow.startDate).toLocaleDateString()} –{" "}
              {new Date(usage.timeWindow.endDate).toLocaleDateString()}
            </p>
          )}
        </div>
      ) : (
        /* Data Display */
        <div className="space-y-6">
          {/* Primary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Total Minutes */}
            <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-5 space-y-1">
              <div className="flex items-center justify-between text-[#a39e94] text-xs">
                <span>Total Billed Minutes</span>
                <Clock className="w-4 h-4 text-[#f59e0b]" />
              </div>
              <div className="text-2xl font-bold text-[#f3eee6] tracking-tight">
                {totalMinutes.toLocaleString()}
                <span className="text-xs font-normal text-[#a39e94] ml-1.5">
                  ({formatHours(totalMinutes)})
                </span>
              </div>
              <p className="text-[10px] text-[#a39e94]">Calculated across all connected participants</p>
            </div>

            {/* Total Sessions */}
            <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-5 space-y-1">
              <div className="flex items-center justify-between text-[#a39e94] text-xs">
                <span>Participant Sessions</span>
                <Users className="w-4 h-4 text-[#38bdf8]" />
              </div>
              <div className="text-2xl font-bold text-[#f3eee6] tracking-tight">
                {totalSessions.toLocaleString()}
              </div>
              <p className="text-[10px] text-[#a39e94]">Distinct joins recorded in ledger</p>
            </div>

            {/* Distinct Rooms */}
            <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-5 space-y-1">
              <div className="flex items-center justify-between text-[#a39e94] text-xs">
                <span>Distinct Rooms</span>
                <Video className="w-4 h-4 text-[#34d399]" />
              </div>
              <div className="text-2xl font-bold text-[#f3eee6] tracking-tight">
                {totalRooms.toLocaleString()}
              </div>
              <p className="text-[10px] text-[#a39e94]">Unique classrooms hosted</p>
            </div>
          </div>

          {/* Breakdown by Role */}
          <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-[#f3eee6]">Participant Role Breakdown</h3>
                <p className="text-[11px] text-[#a39e94]">
                  Distribution of billed minutes by role (tutor vs student)
                </p>
              </div>
              <span className="text-[10px] font-mono text-[#a39e94]">
                {roles.length} active {roles.length === 1 ? "role" : "roles"}
              </span>
            </div>

            {/* Visual ratio bar */}
            {totalMinutes > 0 && (
              <div className="h-3 w-full bg-[#0a0907] rounded-full overflow-hidden flex">
                {roles.map((role, idx) => {
                  const minutes = breakdown[role] || 0;
                  const pct = totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0;
                  const colors = [
                    "bg-[#f59e0b]",
                    "bg-[#38bdf8]",
                    "bg-[#34d399]",
                    "bg-[#a78bfa]",
                  ];
                  const barColor = colors[idx % colors.length];

                  return (
                    <div
                      key={role}
                      style={{ width: `${pct}%` }}
                      className={`${barColor} h-full transition-all`}
                      title={`${role}: ${minutes} mins (${pct.toFixed(1)}%)`}
                    />
                  );
                })}
              </div>
            )}

            {/* Role List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
              {roles.map((role, idx) => {
                const minutes = breakdown[role] || 0;
                const pct = totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0;
                const badgeColors = [
                  "text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/10",
                  "text-[#38bdf8] border-[#38bdf8]/30 bg-[#38bdf8]/10",
                  "text-[#34d399] border-[#34d399]/30 bg-[#34d399]/10",
                  "text-[#a78bfa] border-[#a78bfa]/30 bg-[#a78bfa]/10",
                ];
                const badgeClass = badgeColors[idx % badgeColors.length];

                return (
                  <div
                    key={role}
                    className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-xl p-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold uppercase border ${badgeClass}`}>
                        {role}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-[#f3eee6] font-mono">
                        {minutes.toLocaleString()}m
                      </span>
                      <span className="text-[10px] text-[#a39e94] block font-mono">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Time window & Ledger details */}
          {usage?.timeWindow && (
            <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#a39e94]">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-[#f59e0b]" />
                <span>
                  Query Window:{" "}
                  <span className="font-mono text-[#f3eee6]">
                    {new Date(usage.timeWindow.startDate).toLocaleDateString()}
                  </span>{" "}
                  to{" "}
                  <span className="font-mono text-[#f3eee6]">
                    {new Date(usage.timeWindow.endDate).toLocaleDateString()}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <Info className="w-3.5 h-3.5 text-[#a39e94]" />
                <span>Metered at room leave / SFU peer disconnect.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
