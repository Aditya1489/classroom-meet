import React, { useState } from "react";
import { Webhook, X, Shield, Info, Check } from "lucide-react";
import { toast } from "sonner";

export interface WebhookEndpoint {
  id: string;
  organizationId: string;
  url: string;
  secretPrefix: string;
  events: string[];
  isActive: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateWebhookModalProps {
  orgId: string;
  endpointToEdit?: WebhookEndpoint | null;
  onSuccess: (rawSecret?: string, endpointUrl?: string) => void;
  onClose: () => void;
}

interface WebhookEventDefinition {
  id: string;
  label: string;
  desc: string;
  isImplemented: boolean;
}

const AVAILABLE_EVENTS: WebhookEventDefinition[] = [
  { id: "room.created", label: "room.created", desc: "Triggered whenever a new meeting room is initialized", isImplemented: true },
  { id: "room.ended", label: "room.ended", desc: "Triggered when a room is explicitly terminated or timed out", isImplemented: true },
  { id: "participant.joined", label: "participant.joined", desc: "Triggered when any student or tutor enters a room", isImplemented: false },
  { id: "participant.left", label: "participant.left", desc: "Triggered when a participant disconnects or departs", isImplemented: false },
  { id: "recording.ready", label: "recording.ready", desc: "Triggered when a cloud session recording is processed", isImplemented: false },
];

export const CreateWebhookModal: React.FC<CreateWebhookModalProps> = ({
  orgId,
  endpointToEdit,
  onSuccess,
  onClose,
}) => {
  const isEditing = Boolean(endpointToEdit);
  const [url, setUrl] = useState(endpointToEdit?.url || "");
  const [description, setDescription] = useState(endpointToEdit?.description || "");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(
    endpointToEdit?.events || ["room.created", "room.ended"]
  );
  const [isActive, setIsActive] = useState<boolean>(endpointToEdit?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);

  const token = localStorage.getItem("mathsy_meet_token");
  const getHeaders = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const toggleEvent = (eventId: string) => {
    const eventDef = AVAILABLE_EVENTS.find((e) => e.id === eventId);
    if (eventDef && !eventDef.isImplemented && !selectedEvents.includes(eventId)) {
      return; // Do not allow selecting unsupported events
    }
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast.error("Webhook endpoint URL is required");
      return;
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      toast.error("URL must begin with http:// or https://");
      return;
    }

    if (selectedEvents.length === 0) {
      toast.error("Select at least one event to subscribe to");
      return;
    }

    setSubmitting(true);
    try {
      if (isEditing && endpointToEdit) {
        // PATCH existing endpoint
        const res = await fetch(`/api/organizations/${orgId}/webhooks/${endpointToEdit.id}`, {
          method: "PATCH",
          headers: getHeaders(),
          body: JSON.stringify({
            url: url.trim(),
            description: description.trim() || null,
            events: selectedEvents,
            isActive,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "Failed to update webhook endpoint");
          return;
        }

        toast.success("Webhook endpoint updated successfully");
        onSuccess();
      } else {
        // POST new endpoint
        const res = await fetch(`/api/organizations/${orgId}/webhooks`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            url: url.trim(),
            description: description.trim() || undefined,
            events: selectedEvents,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "Failed to register webhook endpoint");
          return;
        }

        toast.success("Webhook endpoint registered successfully");
        onSuccess(data.secret, url.trim());
      }
    } catch (err: any) {
      console.error("Webhook submit error:", err);
      toast.error("Network error saving webhook endpoint");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#14120e] border border-[#f3eee6]/15 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer p-1 rounded-lg hover:bg-[#1a1814]"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center">
            <Webhook className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3eee6]">
              {isEditing ? "Edit Webhook Endpoint" : "Register Webhook Endpoint"}
            </h2>
            <p className="text-xs text-[#a39e94]">
              Receive real-time signed HTTP POST event notifications
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Target URL */}
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
              Endpoint URL <span className="text-[#f59e0b]">*</span>
            </label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.yourdomain.com/webhooks/mathsy-meet"
              className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2.5 text-xs text-[#f3eee6] font-mono placeholder-[#a39e94]/50 focus:outline-none focus:border-[#f59e0b] transition"
            />
            <p className="text-[10px] text-[#a39e94] mt-1">
              Must be a public HTTPS endpoint. Private IPs (RFC 1918) and cloud metadata targets are rejected for SSRF protection.
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
              Description (Optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Production LMS Notification Handler"
              className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2 text-xs text-[#f3eee6] placeholder-[#a39e94]/50 focus:outline-none focus:border-[#f59e0b] transition"
            />
          </div>

          {/* Subscribed Events */}
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
              Subscribed Event Types <span className="text-[#f59e0b]">*</span>
            </label>
            <div className="space-y-2 bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl p-3 max-h-48 overflow-y-auto">
              {AVAILABLE_EVENTS.map((ev) => {
                const isSelected = selectedEvents.includes(ev.id);
                const isDisabled = !ev.isImplemented && !isSelected;

                return (
                  <label
                    key={ev.id}
                    className={`flex items-start gap-2.5 p-1.5 rounded-lg transition ${
                      isDisabled
                        ? "opacity-55 cursor-not-allowed bg-transparent"
                        : "cursor-pointer hover:bg-[#14120e]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={() => toggleEvent(ev.id)}
                      className="mt-0.5 rounded border-[#f3eee6]/20 text-[#f59e0b] focus:ring-[#f59e0b] disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-[#f3eee6]">
                          {ev.label}
                        </span>
                        {!ev.isImplemented && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-semibold bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30">
                            Coming soon
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-[#a39e94]">
                        {ev.desc}
                        {!ev.isImplemented && (
                          <span className="text-[#a39e94]/70 block mt-0.5">
                            Event emission not yet implemented in media router
                          </span>
                        )}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Active status toggle (if editing) */}
          {isEditing && (
            <div className="flex items-center justify-between p-3 bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl">
              <div>
                <span className="text-xs font-semibold text-[#f3eee6] block">Endpoint Active Status</span>
                <span className="text-[10px] text-[#a39e94]">Toggle whether events are actively dispatched to this endpoint</span>
              </div>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  isActive
                    ? "bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/30"
                    : "bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/30"
                }`}
              >
                {isActive ? "Active" : "Disabled"}
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#f3eee6]/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer disabled:opacity-50"
            >
              {submitting
                ? isEditing
                  ? "Saving..."
                  : "Registering..."
                : isEditing
                ? "Save Changes"
                : "Register Webhook"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
