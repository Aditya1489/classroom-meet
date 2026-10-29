import React, { useState, useEffect } from "react";
import {
  Webhook,
  X,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Code2,
} from "lucide-react";
import { toast } from "sonner";
import { WebhookEndpoint } from "./CreateWebhookModal";
import { API_BASE } from "../../lib/apiConfig";

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  organizationId: string;
  eventId: string;
  eventType: string;
  payload: any;
  responseStatus: number | null;
  responseBody: string | null;
  attemptCount: number;
  status: "delivered" | "failed" | "retrying" | "success" | "pending";
  errorMessage: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

interface WebhookDeliveriesModalProps {
  orgId: string;
  endpoint: WebhookEndpoint;
  onClose: () => void;
}

export const WebhookDeliveriesModal: React.FC<WebhookDeliveriesModalProps> = ({
  orgId,
  endpoint,
  onClose,
}) => {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null);

  const token = localStorage.getItem("mathsy_meet_token");
  const getHeaders = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const fetchDeliveries = async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/webhooks/${endpoint.id}/deliveries`,
        { headers: getHeaders() }
      );
      if (!res.ok) {
        throw new Error("Failed to load deliveries");
      }
      const data = await res.json();
      setDeliveries(data.deliveries || []);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to load webhook delivery history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveries();
  }, [orgId, endpoint.id]);

  const toggleExpand = (id: string) => {
    setExpandedDeliveryId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#14120e] border border-[#f3eee6]/15 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl relative">
        {/* Header */}
        <div className="p-6 border-b border-[#f3eee6]/10 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center">
              <Webhook className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#f3eee6]">Delivery Logs & History</h2>
              <p className="text-xs text-[#a39e94] font-mono truncate max-w-md">{endpoint.url}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchDeliveries}
              disabled={loading}
              title="Refresh deliveries"
              className="p-2 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer border border-[#f3eee6]/10 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer border border-[#f3eee6]/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#a39e94]">
              <RefreshCw className="w-6 h-6 animate-spin text-[#f59e0b] mb-2" />
              <p className="text-xs">Loading delivery logs...</p>
            </div>
          ) : deliveries.length === 0 ? (
            <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-xl p-12 text-center">
              <Clock className="w-8 h-8 text-[#a39e94] mx-auto mb-2 opacity-50" />
              <p className="text-xs font-semibold text-[#f3eee6]">No delivery attempts recorded</p>
              <p className="text-[11px] text-[#a39e94] mt-1 max-w-sm mx-auto">
                Deliveries are logged here whenever subscribed room or participant events are dispatched, or when you send a test ping.
              </p>
            </div>
          ) : (
            deliveries.map((delivery) => {
              const isExpanded = expandedDeliveryId === delivery.id;
              const isRetrying = delivery.status === "retrying";
              const isSuccess =
                delivery.status === "delivered" ||
                delivery.status === "success" ||
                (delivery.responseStatus !== null &&
                  delivery.responseStatus >= 200 &&
                  delivery.responseStatus < 300);

              return (
                <div
                  key={delivery.id}
                  className="bg-[#0a0907] border border-[#f3eee6]/10 hover:border-[#f3eee6]/20 rounded-xl transition overflow-hidden"
                >
                  <div
                    onClick={() => toggleExpand(delivery.id)}
                    className="p-3.5 flex items-center justify-between cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3">
                      {isRetrying ? (
                        <AlertCircle className="w-4 h-4 text-[#f59e0b] shrink-0" />
                      ) : isSuccess ? (
                        <CheckCircle2 className="w-4 h-4 text-[#34d399] shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-[#ef4444] shrink-0" />
                      )}

                      <span className="font-mono text-xs font-bold text-[#f3eee6]">
                        {delivery.eventType}
                      </span>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                          isRetrying
                            ? "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30"
                            : isSuccess
                            ? "bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/30"
                            : "bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30"
                        }`}
                      >
                        {isRetrying
                          ? `Retrying (${delivery.responseStatus ?? "ERR"})`
                          : `HTTP ${delivery.responseStatus ?? "ERR"}`}
                      </span>

                      <span className="text-[11px] text-[#a39e94]">
                        Attempt {delivery.attemptCount}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-[#a39e94]">
                        {new Date(delivery.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-[#a39e94]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[#a39e94]" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="p-4 bg-[#14120e] border-t border-[#f3eee6]/10 space-y-3 text-xs font-mono">
                      {delivery.errorMessage && (
                        <div className="p-2.5 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/20 text-[#ef4444] text-[11px] flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{delivery.errorMessage}</span>
                        </div>
                      )}

                      {/* Request Payload */}
                      <div>
                        <div className="flex items-center gap-1.5 text-[11px] text-[#a39e94] font-sans font-medium mb-1">
                          <Code2 className="w-3.5 h-3.5 text-[#f59e0b]" />
                          <span>Dispatched JSON Payload</span>
                        </div>
                        <pre className="p-3 rounded-lg bg-[#0a0907] border border-[#f3eee6]/10 text-[11px] text-[#f3eee6] overflow-x-auto max-h-48 leading-relaxed">
                          {typeof delivery.payload === "string"
                            ? delivery.payload
                            : JSON.stringify(delivery.payload, null, 2)}
                        </pre>
                      </div>

                      {/* Response Body */}
                      {delivery.responseBody && (
                        <div>
                          <div className="text-[11px] text-[#a39e94] font-sans font-medium mb-1">
                            Receiver HTTP Response Body
                          </div>
                          <pre className="p-3 rounded-lg bg-[#0a0907] border border-[#f3eee6]/10 text-[11px] text-[#a39e94] overflow-x-auto max-h-32 leading-relaxed">
                            {delivery.responseBody}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#f3eee6]/10 flex items-center justify-between text-xs text-[#a39e94]">
          <span>Displaying last 50 deliveries recorded by the webhook dispatch worker.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#f3eee6] font-medium transition cursor-pointer border border-[#f3eee6]/15"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
