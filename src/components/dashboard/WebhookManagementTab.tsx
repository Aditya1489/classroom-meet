import React, { useState, useEffect } from "react";
import {
  Webhook,
  Plus,
  Send,
  History,
  Edit2,
  Trash2,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { CreateWebhookModal, WebhookEndpoint } from "./CreateWebhookModal";
import { WebhookSecretRevealModal } from "./WebhookSecretRevealModal";
import { WebhookDeliveriesModal } from "./WebhookDeliveriesModal";

interface WebhookManagementTabProps {
  orgId: string;
}

export const WebhookManagementTab: React.FC<WebhookManagementTabProps> = ({ orgId }) => {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingEndpointId, setTestingEndpointId] = useState<string | null>(null);
  const [deletingEndpointId, setDeletingEndpointId] = useState<string | null>(null);
  const [copiedUrlId, setCopiedUrlId] = useState<string | null>(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [endpointToEdit, setEndpointToEdit] = useState<WebhookEndpoint | null>(null);
  const [deliveriesEndpoint, setDeliveriesEndpoint] = useState<WebhookEndpoint | null>(null);
  const [revealedSecretData, setRevealedSecretData] = useState<{
    secret: string;
    url: string;
  } | null>(null);

  const token = localStorage.getItem("mathsy_meet_token");
  const getHeaders = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const fetchEndpoints = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/organizations/${orgId}/webhooks`, {
        headers: getHeaders(),
      });
      if (!res.ok) {
        throw new Error("Failed to load webhook endpoints");
      }
      const data = await res.json();
      setEndpoints(data.endpoints || []);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to load webhook endpoints");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEndpoints();
  }, [orgId]);

  const handleCopyUrl = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrlId(id);
      setTimeout(() => setCopiedUrlId(null), 2000);
    } catch (err) {
      console.warn("Failed to copy URL", err);
    }
  };

  const handleSendTestPing = async (endpoint: WebhookEndpoint) => {
    setTestingEndpointId(endpoint.id);
    try {
      const res = await fetch(`/api/organizations/${orgId}/webhooks/${endpoint.id}/test`, {
        method: "POST",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send test ping");
      }
      toast.success("Test ping dispatched! Check delivery history for results.");
    } catch (err: any) {
      toast.error(err.message || "Failed to trigger test event");
    } finally {
      setTestingEndpointId(null);
    }
  };

  const handleDeleteEndpoint = async (endpoint: WebhookEndpoint) => {
    const confirm = window.confirm(
      `Delete webhook endpoint "${endpoint.url}"? Mathsy Meet will immediately stop sending events to this URL.`
    );
    if (!confirm) return;

    setDeletingEndpointId(endpoint.id);
    try {
      const res = await fetch(`/api/organizations/${orgId}/webhooks/${endpoint.id}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete webhook endpoint");
      }
      toast.success("Webhook endpoint deleted");
      fetchEndpoints();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete endpoint");
    } finally {
      setDeletingEndpointId(null);
    }
  };

  const handleModalSuccess = (rawSecret?: string, endpointUrl?: string) => {
    setShowCreateModal(false);
    setEndpointToEdit(null);
    fetchEndpoints();

    if (rawSecret && endpointUrl) {
      setRevealedSecretData({ secret: rawSecret, url: endpointUrl });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-[#f3eee6]">Real-time Webhook Endpoints</h2>
          <p className="text-xs text-[#a39e94]">
            Receive signed HTTP POST events whenever rooms are created, ended, or participants interact
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchEndpoints}
            disabled={loading}
            title="Refresh list"
            className="p-2 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer border border-[#f3eee6]/10 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => {
              setEndpointToEdit(null);
              setShowCreateModal(true);
            }}
            className="px-4 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer flex items-center gap-2 shadow-lg shadow-[#f59e0b]/20"
          >
            <Plus className="w-4 h-4" />
            Register Webhook
          </button>
        </div>
      </div>

      {/* Main endpoints list */}
      {loading ? (
        <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-12 text-center text-[#a39e94]">
          <RefreshCw className="w-6 h-6 animate-spin text-[#f59e0b] mx-auto mb-2" />
          <p className="text-xs">Loading webhook configurations...</p>
        </div>
      ) : endpoints.length === 0 ? (
        <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#f59e0b]/10 text-[#f59e0b] flex items-center justify-center mx-auto mb-4 border border-[#f59e0b]/20">
            <Webhook className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#f3eee6] mb-1">No Webhook Endpoints Configured</h3>
          <p className="text-xs text-[#a39e94] max-w-md mx-auto mb-5 leading-relaxed">
            Register your backend server URL to receive automated callbacks when meetings start, end, or participants join.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Register Webhook Endpoint
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {endpoints.map((ep) => (
            <div
              key={ep.id}
              className="bg-[#14120e] border border-[#f3eee6]/10 hover:border-[#f3eee6]/20 rounded-2xl p-5 transition space-y-3"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono text-xs font-bold text-[#f3eee6] break-all">
                      {ep.url}
                    </span>
                    <button
                      onClick={() => handleCopyUrl(ep.id, ep.url)}
                      className="text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
                      title="Copy URL"
                    >
                      {copiedUrlId === ep.id ? (
                        <Check className="w-3.5 h-3.5 text-[#34d399]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        ep.isActive
                          ? "bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/30"
                          : "bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30"
                      }`}
                    >
                      {ep.isActive ? "Active" : "Disabled"}
                    </span>
                    <span className="font-mono text-[10px] text-[#a39e94] bg-[#0a0907] px-2 py-0.5 rounded-md border border-[#f3eee6]/10">
                      Secret: {ep.secretPrefix}••••••••
                    </span>
                  </div>

                  {ep.description && (
                    <p className="text-xs text-[#a39e94]">{ep.description}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleSendTestPing(ep)}
                    disabled={testingEndpointId === ep.id}
                    title="Send a sample ping event to test connectivity"
                    className="px-3 py-1.5 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#f3eee6] text-xs font-medium border border-[#f3eee6]/10 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className={`w-3.5 h-3.5 text-[#f59e0b] ${testingEndpointId === ep.id ? "animate-pulse" : ""}`} />
                    <span>{testingEndpointId === ep.id ? "Pinging..." : "Test Ping"}</span>
                  </button>

                  <button
                    onClick={() => setDeliveriesEndpoint(ep)}
                    title="View delivery history and attempt logs"
                    className="px-3 py-1.5 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#f3eee6] text-xs font-medium border border-[#f3eee6]/10 transition cursor-pointer flex items-center gap-1.5"
                  >
                    <History className="w-3.5 h-3.5 text-[#38bdf8]" />
                    <span>Deliveries</span>
                  </button>

                  <button
                    onClick={() => {
                      setEndpointToEdit(ep);
                      setShowCreateModal(true);
                    }}
                    title="Edit subscribed events or endpoint settings"
                    className="p-2 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#a39e94] hover:text-[#f3eee6] border border-[#f3eee6]/10 transition cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleDeleteEndpoint(ep)}
                    disabled={deletingEndpointId === ep.id}
                    title="Delete webhook endpoint"
                    className="p-2 rounded-xl bg-[#1a1814] hover:bg-[#ef4444]/20 text-[#a39e94] hover:text-[#ef4444] border border-[#f3eee6]/10 transition cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Subscribed events tags */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-[#f3eee6]/5">
                <span className="text-[11px] text-[#a39e94] font-medium mr-1">Events:</span>
                {ep.events.map((ev) => (
                  <span
                    key={ev}
                    className="px-2 py-0.5 rounded-md bg-[#0a0907] border border-[#f3eee6]/10 text-[10px] font-mono text-[#f59e0b]"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Security Callout */}
      <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-5 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#34d399]" />
          <h4 className="text-xs font-bold text-[#f3eee6]">Webhook Security Architecture</h4>
        </div>
        <p className="text-[11px] text-[#a39e94] leading-relaxed">
          Each webhook notification includes an <code className="text-[#34d399] font-mono">X-Mathsy-Signature</code> header containing a timestamp and HMAC-SHA256 digest computed with your endpoint signing secret. Endpoints are protected against replay attacks and SSRF on private network addresses (RFC 1918).
        </p>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateWebhookModal
          orgId={orgId}
          endpointToEdit={endpointToEdit}
          onSuccess={handleModalSuccess}
          onClose={() => {
            setShowCreateModal(false);
            setEndpointToEdit(null);
          }}
        />
      )}

      {revealedSecretData && (
        <WebhookSecretRevealModal
          secret={revealedSecretData.secret}
          url={revealedSecretData.url}
          onClose={() => setRevealedSecretData(null)}
        />
      )}

      {deliveriesEndpoint && (
        <WebhookDeliveriesModal
          orgId={orgId}
          endpoint={deliveriesEndpoint}
          onClose={() => setDeliveriesEndpoint(null)}
        />
      )}
    </div>
  );
};
