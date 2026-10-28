import React, { useState } from "react";
import { Key, X, Shield, Lock, Calendar } from "lucide-react";
import { toast } from "sonner";

interface CreateApiKeyModalProps {
  orgId: string;
  onSuccess: (rawKey: string, keyName: string, environment: "live" | "test") => void;
  onClose: () => void;
}

export const CreateApiKeyModal: React.FC<CreateApiKeyModalProps> = ({
  orgId,
  onSuccess,
  onClose,
}) => {
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [permissions, setPermissions] = useState<string[]>([
    "rooms:read",
    "rooms:write",
    "tokens:write",
  ]);
  const [expiryDays, setExpiryDays] = useState<number | "never">("never");
  const [submitting, setSubmitting] = useState(false);

  const togglePermission = (perm: string) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a name for the API key");
      return;
    }
    if (permissions.length === 0) {
      toast.error("Select at least one permission");
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem("mathsy_meet_token");
      let expiresAt: string | null = null;
      if (typeof expiryDays === "number") {
        const d = new Date();
        d.setDate(d.getDate() + expiryDays);
        expiresAt = d.toISOString();
      }

      const res = await fetch(`/api/organizations/${orgId}/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          environment,
          permissions,
          expires_at: expiresAt,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.code === "KEY_NAME_EXISTS") {
          toast.error(`An active key with the name "${name.trim()}" already exists.`);
        } else {
          toast.error(data.error || "Failed to create API key");
        }
        setSubmitting(false);
        return;
      }

      toast.success("API key created successfully");
      onSuccess(data.rawKey, name.trim(), environment);
    } catch (err: any) {
      console.error("Create API key error:", err);
      toast.error("Network error while creating API key");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#14120e] border border-[#f3eee6]/15 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer p-1 rounded-lg hover:bg-[#1a1814]"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3eee6]">Generate New API Key</h2>
            <p className="text-xs text-[#a39e94]">Provision credentials for machine-to-machine integrations</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Key Name */}
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
              Key Name <span className="text-[#f59e0b]">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Backend Production Server"
              className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2.5 text-xs text-[#f3eee6] placeholder-[#a39e94]/50 focus:outline-none focus:border-[#f59e0b] transition"
            />
          </div>

          {/* Environment */}
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">Environment</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEnvironment("live")}
                className={`py-2 px-3 rounded-xl border text-xs font-medium transition cursor-pointer flex items-center justify-center gap-2 ${
                  environment === "live"
                    ? "bg-[#f59e0b]/20 border-[#f59e0b] text-[#f59e0b]"
                    : "bg-[#0a0907] border-[#f3eee6]/15 text-[#a39e94] hover:border-[#f3eee6]/30"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                Live (sec_live_)
              </button>
              <button
                type="button"
                onClick={() => setEnvironment("test")}
                className={`py-2 px-3 rounded-xl border text-xs font-medium transition cursor-pointer flex items-center justify-center gap-2 ${
                  environment === "test"
                    ? "bg-[#3b82f6]/20 border-[#3b82f6] text-[#3b82f6]"
                    : "bg-[#0a0907] border-[#f3eee6]/15 text-[#a39e94] hover:border-[#f3eee6]/30"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-[#3b82f6]" />
                Test (sec_test_)
              </button>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">Permissions & Scopes</label>
            <div className="space-y-2 bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl p-3 text-xs">
              {[
                { id: "rooms:read", label: "rooms:read", desc: "View room details and list participants" },
                { id: "rooms:write", label: "rooms:write", desc: "Create, configure, and end video rooms" },
                { id: "tokens:write", label: "tokens:write", desc: "Mint participant tokens for tutors and students" },
              ].map((perm) => (
                <label key={perm.id} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permissions.includes(perm.id)}
                    onChange={() => togglePermission(perm.id)}
                    className="mt-0.5 rounded border-[#f3eee6]/20 text-[#f59e0b] focus:ring-[#f59e0b]"
                  />
                  <div>
                    <span className="font-mono text-[11px] font-semibold text-[#f3eee6]">{perm.label}</span>
                    <p className="text-[10px] text-[#a39e94]">{perm.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Expiration */}
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">Key Expiration</label>
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value === "never" ? "never" : Number(e.target.value))}
              className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2.5 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b] transition"
            >
              <option value="never">Never expires (Recommended for backend servers)</option>
              <option value="30">Expires in 30 days</option>
              <option value="90">Expires in 90 days</option>
              <option value="365">Expires in 1 year</option>
            </select>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#f3eee6]/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-transparent hover:bg-[#1a1814] text-xs font-medium text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer flex items-center gap-2 shadow-lg shadow-[#f59e0b]/20 disabled:opacity-50"
            >
              {submitting ? "Generating..." : "Generate Key"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
