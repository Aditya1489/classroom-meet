import React, { useState } from "react";
import { Building, X } from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "../../lib/apiConfig";

interface CreateOrgModalProps {
  onSuccess: (newOrg: any) => void;
  onClose: () => void;
}

export const CreateOrgModal: React.FC<CreateOrgModalProps> = ({
  onSuccess,
  onClose,
}) => {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter an organization name");
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem("mathsy_meet_token");
      const res = await fetch(`${API_BASE}/organizations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: name.trim() }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // Safe fallback if server returns non-JSON error
      }

      if (!res.ok) {
        toast.error(data.error || `Failed to create organization (${res.status})`);
        setSubmitting(false);
        return;
      }

      toast.success("Organization created successfully");
      onSuccess(data.organization);
    } catch (err: any) {
      console.error("Create Org error:", err);
      toast.error("Network error while creating organization");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#14120e] border border-[#f3eee6]/15 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer p-1 rounded-lg hover:bg-[#1a1814]"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center">
            <Building className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3eee6]">Create Organization</h2>
            <p className="text-xs text-[#a39e94]">Setup a new workspace / tenant</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#f3eee6] mb-1.5">
              Organization / Company Name <span className="text-[#f59e0b]">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Apex Learning Corp"
              className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2.5 text-xs text-[#f3eee6] placeholder-[#a39e94]/50 focus:outline-none focus:border-[#f59e0b] transition"
            />
          </div>

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
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
