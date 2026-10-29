import React, { useState } from "react";
import { Globe, X, Plus, Trash2, Palette } from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "../../lib/apiConfig";

interface CreateAppModalProps {
  orgId: string;
  onSuccess: () => void;
  onClose: () => void;
}

export const CreateAppModal: React.FC<CreateAppModalProps> = ({
  orgId,
  onSuccess,
  onClose,
}) => {
  const [appName, setAppName] = useState("");
  const [domainsInput, setDomainsInput] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#4f46e5");
  const [logoUrl, setLogoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appName.trim()) {
      toast.error("Please enter an application name");
      return;
    }

    const allowedDomains = domainsInput
      .split(/[\n,]+/)
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);

    setSubmitting(true);
    try {
      const token = localStorage.getItem("mathsy_meet_token");
      const res = await fetch(`${API_BASE}/organizations/${orgId}/apps`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          appName: appName.trim(),
          allowedDomains,
          branding: {
            primaryColor,
            logoUrl: logoUrl.trim() || null,
          },
        }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // Safe fallback for non-JSON errors
      }

      if (!res.ok) {
        if (data.code === "APP_NAME_EXISTS") {
          toast.error(`An application with name "${appName.trim()}" already exists in this organization.`);
        } else {
          toast.error(data.error || `Failed to register customer app (${res.status})`);
        }
        setSubmitting(false);
        return;
      }

      toast.success("Application registered with allowed domains");
      onSuccess();
    } catch (err: any) {
      console.error("Create App error:", err);
      toast.error("Network error while creating app");
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
          <div className="w-10 h-10 rounded-xl bg-[#3b82f6]/20 text-[#3b82f6] flex items-center justify-center">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3eee6]">Register Customer App</h2>
            <p className="text-xs text-[#a39e94]">Configure allowed embed domains & branding</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* App Name */}
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
              Application Name <span className="text-[#f59e0b]">*</span>
            </label>
            <input
              type="text"
              required
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="e.g. Student LMS Portal"
              className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2.5 text-xs text-[#f3eee6] placeholder-[#a39e94]/50 focus:outline-none focus:border-[#3b82f6] transition"
            />
          </div>

          {/* Allowed Domains */}
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
              Allowed Parent Domains / Origins
            </label>
            <p className="text-[11px] text-[#a39e94] mb-2 leading-relaxed">
              Domains permitted to embed your meetings inside an iframe. Enter origins or wildcards separated by newlines or commas (e.g. <code className="text-[#34d399] font-mono">https://lms.myedu.com</code>, <code className="text-[#34d399] font-mono">*.myedu.com</code>).
            </p>
            <textarea
              rows={3}
              value={domainsInput}
              onChange={(e) => setDomainsInput(e.target.value)}
              placeholder="https://app.example.com&#10;https://portal.example.com&#10;*.example.com"
              className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2.5 font-mono text-xs text-[#f3eee6] placeholder-[#a39e94]/40 focus:outline-none focus:border-[#3b82f6] transition resize-none"
            />
          </div>

          {/* Branding Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-[#a39e94]" />
                Primary Color
              </label>
              <div className="flex items-center gap-2 bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl p-1.5">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-7 h-7 rounded border-none bg-transparent cursor-pointer"
                />
                <span className="font-mono text-xs text-[#f3eee6] uppercase">{primaryColor}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">Logo URL (Optional)</label>
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://.../logo.png"
                className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3 py-2 text-xs text-[#f3eee6] placeholder-[#a39e94]/40 focus:outline-none focus:border-[#3b82f6] transition"
              />
            </div>
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
              className="px-5 py-2.5 rounded-xl bg-[#3b82f6] hover:bg-[#2563eb] text-white font-bold text-xs transition cursor-pointer flex items-center gap-2 shadow-lg shadow-[#3b82f6]/20 disabled:opacity-50"
            >
              {submitting ? "Registering..." : "Register App"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
