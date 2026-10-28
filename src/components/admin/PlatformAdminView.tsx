import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  Building,
  Key,
  Plus,
  Search,
  RotateCw,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  ArrowLeft,
  Users,
  Code,
  Globe,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Lock,
  ChevronRight,
  Info,
  Server,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { ApiKeyRevealModal } from "../dashboard/ApiKeyRevealModal";

interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
  planTier: string;
  monthlyMinuteLimit: number;
  maxConcurrentRooms: number;
  settings: any;
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    email: string;
    name: string;
  } | null;
  memberCount: number;
  activeKeysCount: number;
  appsCount: number;
}

interface MaskedApiKey {
  id: string;
  organization_id: string;
  name: string;
  key_prefix: string;
  masked_key: string;
  environment: "live" | "test";
  is_active: boolean;
  permissions: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface OrgMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  createdAt: string;
}

interface CustomerApp {
  id: string;
  appName: string;
  allowedDomains: string[];
  branding: any;
  createdAt: string;
}

interface PlatformAdminViewProps {
  onBackToHome: () => void;
}

export const PlatformAdminView: React.FC<PlatformAdminViewProps> = ({ onBackToHome }) => {
  const [isSuperadmin, setIsSuperadmin] = useState<boolean | null>(null);
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<AdminOrganization | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Selected org details
  const [orgKeys, setOrgKeys] = useState<MaskedApiKey[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [orgApps, setOrgApps] = useState<CustomerApp[]>([]);

  // Modals state
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
  const [revealedKeyData, setRevealedKeyData] = useState<{
    rawKey: string;
    name: string;
    environment: "live" | "test";
  } | null>(null);

  // Form states
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [newOrgOwnerEmail, setNewOrgOwnerEmail] = useState("");
  const [newOrgPlan, setNewOrgPlan] = useState("free");
  const [creatingOrg, setCreatingOrg] = useState(false);

  // Key form states
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState<"live" | "test">("live");
  const [newKeyPermissions, setNewKeyPermissions] = useState<string[]>([
    "rooms:read",
    "rooms:write",
    "tokens:write",
  ]);
  const [newKeyExpiryDays, setNewKeyExpiryDays] = useState<string>("never");
  const [creatingKey, setCreatingKey] = useState(false);

  // Action states
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const token = localStorage.getItem("mathsy_meet_token");

  const getHeaders = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const baseUrl = window.location.origin;

  // 1. Verify Platform Superadmin Authorization
  useEffect(() => {
    const checkSuperadmin = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/admin/check", { headers: getHeaders() });
        if (!res.ok) {
          setIsSuperadmin(false);
          setLoading(false);
          return;
        }
        const data = await res.json();
        setIsSuperadmin(Boolean(data.isSuperadmin));
        if (data.isSuperadmin) {
          await loadOrganizations();
        }
      } catch (err) {
        console.error("Superadmin check error:", err);
        setIsSuperadmin(false);
      } finally {
        setLoading(false);
      }
    };

    checkSuperadmin();
  }, []);

  // 2. Fetch Organizations across platform
  const loadOrganizations = async (search = "") => {
    try {
      const url = search ? `/api/admin/organizations?q=${encodeURIComponent(search)}` : "/api/admin/organizations";
      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) {
        throw new Error("Failed to load organizations");
      }
      const data = await res.json();
      setOrganizations(data.organizations || []);
      if (data.organizations && data.organizations.length > 0 && !selectedOrg) {
        setSelectedOrg(data.organizations[0]);
        loadOrgDetails(data.organizations[0].id);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load organizations");
    }
  };

  // 3. Load Selected Organization Details (Keys, Members, Apps)
  const loadOrgDetails = async (orgId: string) => {
    try {
      setDetailsLoading(true);
      const res = await fetch(`/api/admin/organizations/${orgId}`, { headers: getHeaders() });
      if (!res.ok) {
        throw new Error("Failed to load organization profile");
      }
      const data = await res.json();
      setOrgKeys(data.keys || []);
      setOrgMembers(data.members || []);
      setOrgApps(data.apps || []);
    } catch (err: any) {
      toast.error(err.message || "Error fetching organization details");
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleSelectOrg = (org: AdminOrganization) => {
    setSelectedOrg(org);
    loadOrgDetails(org.id);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadOrganizations(searchQuery);
  };

  // 4. Create Customer Organization
  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) {
      toast.error("Organization name is required");
      return;
    }

    setCreatingOrg(true);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          name: newOrgName.trim(),
          slug: newOrgSlug.trim() || undefined,
          ownerEmail: newOrgOwnerEmail.trim() || undefined,
          planTier: newOrgPlan,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create customer organization");
        return;
      }

      toast.success("Customer organization onboarded successfully");
      setShowCreateOrgModal(false);
      setNewOrgName("");
      setNewOrgSlug("");
      setNewOrgOwnerEmail("");
      setNewOrgPlan("free");

      await loadOrganizations();
      if (data.organization) {
        setSelectedOrg(data.organization);
        loadOrgDetails(data.organization.id);
      }
    } catch (err: any) {
      toast.error("Network error while creating organization");
    } finally {
      setCreatingOrg(false);
    }
  };

  // 5. Issue API Key for Selected Org
  const handleIssueKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg) return;
    if (!newKeyName.trim()) {
      toast.error("Key name is required");
      return;
    }

    setCreatingKey(true);
    try {
      let expiresAt: string | null = null;
      if (newKeyExpiryDays !== "never") {
        const days = parseInt(newKeyExpiryDays, 10);
        const d = new Date();
        d.setDate(d.getDate() + days);
        expiresAt = d.toISOString();
      }

      const res = await fetch(`/api/admin/organizations/${selectedOrg.id}/keys`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          name: newKeyName.trim(),
          environment: newKeyEnv,
          permissions: newKeyPermissions,
          expires_at: expiresAt,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to issue API key");
        return;
      }

      setShowCreateKeyModal(false);
      setNewKeyName("");
      setRevealedKeyData({
        rawKey: data.rawKey,
        name: newKeyName.trim(),
        environment: newKeyEnv,
      });

      toast.success("API key issued. Make sure to copy the secret key.");
      await loadOrgDetails(selectedOrg.id);
      await loadOrganizations(searchQuery);
    } catch (err: any) {
      toast.error("Network error issuing API key");
    } finally {
      setCreatingKey(false);
    }
  };

  // 6. Rotate API Key
  const handleRotateKey = async (key: MaskedApiKey) => {
    if (!selectedOrg) return;
    const confirmed = window.confirm(
      `Are you sure you want to rotate API key "${key.name}"? The current key will be revoked immediately and a new secret key will be generated.`
    );
    if (!confirmed) return;

    setActionLoadingId(key.id);
    try {
      const res = await fetch(`/api/admin/organizations/${selectedOrg.id}/keys/${key.id}/rotate`, {
        method: "POST",
        headers: getHeaders(),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to rotate API key");
        return;
      }

      setRevealedKeyData({
        rawKey: data.rawKey,
        name: key.name,
        environment: key.environment,
      });

      toast.success("API key rotated successfully");
      await loadOrgDetails(selectedOrg.id);
    } catch (err: any) {
      toast.error("Network error rotating API key");
    } finally {
      setActionLoadingId(null);
    }
  };

  // 7. Revoke API Key
  const handleRevokeKey = async (key: MaskedApiKey) => {
    if (!selectedOrg) return;
    const confirmed = window.confirm(
      `Are you sure you want to permanently revoke API key "${key.name}"? Machine requests using this key will immediately fail.`
    );
    if (!confirmed) return;

    setActionLoadingId(key.id);
    try {
      const res = await fetch(`/api/admin/organizations/${selectedOrg.id}/keys/${key.id}`, {
        method: "DELETE",
        headers: getHeaders(),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to revoke API key");
        return;
      }

      toast.success(`Key "${key.name}" revoked`);
      await loadOrgDetails(selectedOrg.id);
      await loadOrganizations(searchQuery);
    } catch (err: any) {
      toast.error("Network error revoking API key");
    } finally {
      setActionLoadingId(null);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSnippet(id);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopiedSnippet(null), 2500);
    } catch (e) {
      toast.error("Failed to copy");
    }
  };

  // Access Denied Screen if unauthorized
  if (!loading && isSuperadmin === false) {
    return (
      <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col items-center justify-center p-6">
        <div className="bg-[#14120e] border border-[#ef4444]/30 rounded-3xl p-10 max-w-md w-full text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-[#ef4444]/15 text-[#ef4444] flex items-center justify-center mx-auto border border-[#ef4444]/30">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-[#f3eee6]">Platform Superadmin Required</h1>
          <p className="text-xs text-[#a39e94] leading-relaxed">
            Access to cross-tenant organization management and credential issuance is restricted strictly to verified Mathsy Meet platform superadmins.
          </p>
          <div className="pt-2">
            <button
              onClick={onBackToHome}
              className="px-5 py-2.5 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#f3eee6] border border-[#f3eee6]/15 text-xs font-semibold transition cursor-pointer inline-flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Meetings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col selection:bg-[#f59e0b]/30">
      {/* Platform Superadmin Header */}
      <header className="border-b border-[#f3eee6]/10 bg-[#14120e] px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToHome}
            className="flex items-center gap-1.5 text-xs text-[#a39e94] hover:text-[#f3eee6] bg-[#1a1814] px-3 py-1.5 rounded-xl border border-[#f3eee6]/10 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Meetings</span>
          </button>

          <div className="h-4 w-px bg-[#f3eee6]/15" />

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#d97706] text-[#0e0d0b] flex items-center justify-center font-bold shadow-lg shadow-[#f59e0b]/20">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-[#f3eee6]">
                  Platform<span className="text-[#f59e0b]">Superadmin</span>
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/25 font-semibold">
                  Cross-Tenant Console
                </span>
              </div>
              <p className="text-[10px] text-[#a39e94]">B2B Customer Onboarding & API Credential Lifecycle</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreateOrgModal(true)}
            className="px-3.5 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md shadow-[#f59e0b]/20"
          >
            <Plus className="w-4 h-4" />
            <span>Onboard Customer</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 lg:p-8 flex flex-col md:flex-row gap-6">
        {/* Left Column: Organization Directory & Search */}
        <div className="w-full md:w-80 shrink-0 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#a39e94]">
              Customer Organizations ({organizations.length})
            </h2>
            <button
              onClick={() => loadOrganizations(searchQuery)}
              className="text-[#a39e94] hover:text-[#f3eee6] text-xs transition"
              title="Refresh Organizations"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search Box */}
          <form onSubmit={handleSearch} className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, slug, email..."
              className="w-full bg-[#14120e] border border-[#f3eee6]/15 rounded-xl pl-9 pr-3 py-2 text-xs text-[#f3eee6] placeholder-[#a39e94]/50 focus:outline-none focus:border-[#f59e0b] transition"
            />
            <Search className="w-4 h-4 text-[#a39e94] absolute left-3 top-1/2 -translate-y-1/2" />
          </form>

          {/* Organization List */}
          <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {organizations.length === 0 ? (
              <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-6 text-center text-xs text-[#a39e94]">
                No organizations found
              </div>
            ) : (
              organizations.map((org) => {
                const isSelected = selectedOrg?.id === org.id;
                const isSystem = org.id === "00000000-0000-0000-0000-000000000001";
                return (
                  <button
                    key={org.id}
                    onClick={() => handleSelectOrg(org)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition cursor-pointer flex flex-col gap-1.5 ${
                      isSelected
                        ? "bg-[#1f1b14] border-[#f59e0b] shadow-md shadow-[#f59e0b]/10"
                        : "bg-[#14120e] border-[#f3eee6]/10 hover:border-[#f3eee6]/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-[#f3eee6] truncate max-w-[170px]">
                        {org.name}
                      </span>
                      {isSystem ? (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/30">
                          System
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/25">
                          {org.planTier}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-[#a39e94]">
                      <span className="font-mono truncate max-w-[140px]">
                        {org.owner ? org.owner.email : "No owner linked"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Key className="w-2.5 h-2.5 text-[#f59e0b]" />
                        {org.activeKeysCount} keys
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Organization Workspace */}
        <div className="flex-1 space-y-6">
          {!selectedOrg ? (
            <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-3xl p-12 text-center text-[#a39e94]">
              Select an organization from the directory to manage credentials and handoff instructions.
            </div>
          ) : (
            <>
              {/* Organization Header Banner */}
              <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-3xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#f59e0b]/15 text-[#f59e0b] flex items-center justify-center font-bold text-lg border border-[#f59e0b]/25">
                      <Building className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h1 className="text-lg font-bold text-[#f3eee6]">{selectedOrg.name}</h1>
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/25">
                          {selectedOrg.status}
                        </span>
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[#f3eee6]/10 text-[#a39e94] border border-[#f3eee6]/15">
                          Plan: {selectedOrg.planTier}
                        </span>
                      </div>
                      <p className="text-xs text-[#a39e94] font-mono mt-0.5">
                        Tenant ID: <span className="text-[#f3eee6]">{selectedOrg.id}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <button
                      onClick={() => setShowCreateKeyModal(true)}
                      className="px-4 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md shadow-[#f59e0b]/20"
                    >
                      <Plus className="w-4 h-4" />
                      Issue API Key
                    </button>
                  </div>
                </div>

                {/* Metadata summary bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[#f3eee6]/[0.08] text-xs">
                  <div>
                    <span className="text-[10px] text-[#a39e94] block">Slug</span>
                    <span className="font-mono text-[#f3eee6] text-[11px]">{selectedOrg.slug}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#a39e94] block">Owner Account</span>
                    <span className="font-mono text-[#f3eee6] text-[11px] truncate block">
                      {selectedOrg.owner ? selectedOrg.owner.email : "None"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#a39e94] block">Members</span>
                    <span className="font-mono text-[#f3eee6] text-[11px]">{orgMembers.length} users</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#a39e94] block">Whitelisted Apps</span>
                    <span className="font-mono text-[#f3eee6] text-[11px]">{orgApps.length} apps</span>
                  </div>
                </div>
              </div>

              {/* SECTION 1: M2M API Keys Management */}
              <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-[#f3eee6] flex items-center gap-2">
                      <Key className="w-4 h-4 text-[#f59e0b]" />
                      Server-to-Server Credentials ({orgKeys.length})
                    </h2>
                    <p className="text-xs text-[#a39e94]">
                      Provision machine credentials for customer backend room creation & participant token minting
                    </p>
                  </div>

                  <button
                    onClick={() => loadOrgDetails(selectedOrg.id)}
                    className="p-1.5 rounded-lg bg-[#1a1814] hover:bg-[#25221c] text-[#a39e94] hover:text-[#f3eee6] border border-[#f3eee6]/10 transition"
                    title="Refresh keys"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {orgKeys.length === 0 ? (
                  <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-2xl p-8 text-center text-xs text-[#a39e94]">
                    No credentials generated yet. Issue a key to grant this customer access to the B2B REST API.
                  </div>
                ) : (
                  <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#14120e] border-b border-[#f3eee6]/10 text-[11px] font-semibold text-[#a39e94]">
                        <tr>
                          <th className="py-3 px-4">Key Name</th>
                          <th className="py-3 px-4">Masked Secret</th>
                          <th className="py-3 px-4">Environment</th>
                          <th className="py-3 px-4">Permissions</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f3eee6]/[0.06]">
                        {orgKeys.map((key) => (
                          <tr key={key.id} className="hover:bg-[#1a1814]/50 transition">
                            <td className="py-3 px-4 font-semibold text-[#f3eee6]">{key.name}</td>
                            <td className="py-3 px-4 font-mono text-xs">
                              <span className="text-[#a39e94]">{key.masked_key}</span>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-semibold ${
                                  key.environment === "live"
                                    ? "bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/30"
                                    : "bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30"
                                }`}
                              >
                                {key.environment}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap gap-1">
                                {key.permissions.map((p) => (
                                  <span
                                    key={p}
                                    className="text-[9px] font-mono bg-[#14120e] border border-[#f3eee6]/15 px-1.5 py-0.5 rounded text-[#a39e94]"
                                  >
                                    {p}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {key.is_active ? (
                                <span className="text-[10px] font-semibold text-[#34d399] flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                                  Active
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-[#ef4444] flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                                  Revoked
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {key.is_active ? (
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => handleRotateKey(key)}
                                    disabled={actionLoadingId === key.id}
                                    title="Rotate Key (Atomic replacement)"
                                    className="p-1.5 rounded-lg bg-[#14120e] hover:bg-[#25221c] border border-[#f3eee6]/15 text-[#a39e94] hover:text-[#f59e0b] transition cursor-pointer"
                                  >
                                    <RotateCw className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleRevokeKey(key)}
                                    disabled={actionLoadingId === key.id}
                                    title="Revoke Key"
                                    className="p-1.5 rounded-lg bg-[#14120e] hover:bg-[#ef4444]/20 border border-[#f3eee6]/15 text-[#a39e94] hover:text-[#ef4444] transition cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] text-[#a39e94] italic">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* SECTION 2: Customer Handoff Card */}
              <div className="bg-[#14120e] border border-[#f59e0b]/25 rounded-3xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center">
                      <Code className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-[#f3eee6]">External Customer Handoff Summary</h2>
                      <p className="text-xs text-[#a39e94]">
                        Deliver these integration parameters and safe delivery instructions to the customer engineering team
                      </p>
                    </div>
                  </div>
                </div>

                {/* Safe Delivery Warning */}
                <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-2xl p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#f59e0b] shrink-0 mt-0.5" />
                  <div className="text-xs text-[#f3eee6] leading-relaxed">
                    <span className="font-semibold text-[#f59e0b]">Safe Credential Delivery Protocol:</span> Stored API keys are cryptographically hashed and cannot be recovered. Deliver newly generated secret keys to the customer developer using an encrypted secret link (e.g. 1Password Secret Link or HashiCorp Vault). Never transmit raw API keys via plain text email or Slack.
                  </div>
                </div>

                {/* Quick copy endpoints */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* API Base URL */}
                  <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-[#a39e94]">API Control Plane Base URL</label>
                      <button
                        onClick={() => copyToClipboard(baseUrl, "base_url")}
                        className="text-[#a39e94] hover:text-[#f3eee6] text-xs flex items-center gap-1 transition"
                      >
                        {copiedSnippet === "base_url" ? (
                          <Check className="w-3.5 h-3.5 text-[#34d399]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedSnippet === "base_url" ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    <code className="text-xs font-mono text-[#34d399] block break-all">{baseUrl}</code>
                  </div>

                  {/* Embed Base URL */}
                  <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-[#a39e94]">Hosted Meeting Embed Pattern</label>
                      <button
                        onClick={() => copyToClipboard(`${baseUrl}/v1/embed/:roomId?token=:participantToken`, "embed_url")}
                        className="text-[#a39e94] hover:text-[#f3eee6] text-xs flex items-center gap-1 transition"
                      >
                        {copiedSnippet === "embed_url" ? (
                          <Check className="w-3.5 h-3.5 text-[#34d399]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedSnippet === "embed_url" ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    <code className="text-xs font-mono text-[#f59e0b] block break-all">
                      {baseUrl}/v1/embed/:roomId?token=:participantToken
                    </code>
                  </div>
                </div>

                {/* Code Snippets */}
                <div className="space-y-3">
                  <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#f3eee6]">HTML iframe Integration Snippet</span>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `<iframe\n  src="${baseUrl}/v1/embed/<ROOM_ID>?token=<PARTICIPANT_TOKEN>"\n  allow="camera; microphone; display-capture; autoplay"\n  width="100%"\n  height="100%"\n  style="border: none;"\n></iframe>`,
                            "iframe_code"
                          )
                        }
                        className="text-[#a39e94] hover:text-[#f3eee6] text-xs flex items-center gap-1 transition"
                      >
                        {copiedSnippet === "iframe_code" ? (
                          <Check className="w-3.5 h-3.5 text-[#34d399]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedSnippet === "iframe_code" ? "Copied" : "Copy iframe"}</span>
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-[#a39e94] bg-[#14120e] p-3 rounded-xl overflow-x-auto">
{`<iframe
  src="${baseUrl}/v1/embed/<ROOM_ID>?token=<PARTICIPANT_TOKEN>"
  allow="camera; microphone; display-capture; autoplay"
  width="100%"
  height="100%"
  style="border: none;"
></iframe>`}
                    </pre>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* MODAL 1: Onboard Customer Organization */}
      {showCreateOrgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#14120e] border border-[#f3eee6]/15 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center">
                <Building className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#f3eee6]">Onboard Customer Organization</h2>
                <p className="text-xs text-[#a39e94]">Create a new enterprise tenant workspace</p>
              </div>
            </div>

            <form onSubmit={handleCreateOrg} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#f3eee6] mb-1">
                  Customer Organization Name <span className="text-[#f59e0b]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="e.g. Acme EdTech Academy"
                  className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#f3eee6] mb-1">Slug (Optional)</label>
                <input
                  type="text"
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value)}
                  placeholder="Auto-generated if left blank"
                  className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2 text-xs text-[#f3eee6] font-mono focus:outline-none focus:border-[#f59e0b]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#f3eee6] mb-1">
                  Customer Owner Email (Optional)
                </label>
                <input
                  type="email"
                  value={newOrgOwnerEmail}
                  onChange={(e) => setNewOrgOwnerEmail(e.target.value)}
                  placeholder="admin@customer.com"
                  className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                />
                <p className="text-[10px] text-[#a39e94] mt-1">
                  If an account exists with this email, they will be attached as organization owner.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#f3eee6] mb-1">Plan Tier</label>
                <select
                  value={newOrgPlan}
                  onChange={(e) => setNewOrgPlan(e.target.value)}
                  className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                >
                  <option value="free">Free Tier (10,000 min/mo)</option>
                  <option value="pro">Pro Tier (50,000 min/mo)</option>
                  <option value="enterprise">Enterprise Tier (Unlimited / Custom)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#f3eee6]/10">
                <button
                  type="button"
                  onClick={() => setShowCreateOrgModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingOrg}
                  className="px-5 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {creatingOrg ? "Onboarding..." : "Onboard Customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Issue API Key for Customer */}
      {showCreateKeyModal && selectedOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#14120e] border border-[#f3eee6]/15 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#f3eee6]">Issue API Key</h2>
                <p className="text-xs text-[#a39e94]">For: {selectedOrg.name}</p>
              </div>
            </div>

            <form onSubmit={handleIssueKey} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#f3eee6] mb-1">
                  Key Name <span className="text-[#f59e0b]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. Production Server Key"
                  className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#f3eee6] mb-1">Environment</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewKeyEnv("live")}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium transition cursor-pointer flex items-center justify-center gap-2 ${
                      newKeyEnv === "live"
                        ? "bg-[#f59e0b]/20 border-[#f59e0b] text-[#f59e0b]"
                        : "bg-[#0a0907] border-[#f3eee6]/15 text-[#a39e94]"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                    Live (sec_live_)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewKeyEnv("test")}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium transition cursor-pointer flex items-center justify-center gap-2 ${
                      newKeyEnv === "test"
                        ? "bg-[#3b82f6]/20 border-[#3b82f6] text-[#3b82f6]"
                        : "bg-[#0a0907] border-[#f3eee6]/15 text-[#a39e94]"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-[#3b82f6]" />
                    Test (sec_test_)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#f3eee6] mb-1">Expiration</label>
                <select
                  value={newKeyExpiryDays}
                  onChange={(e) => setNewKeyExpiryDays(e.target.value)}
                  className="w-full bg-[#0a0907] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                >
                  <option value="never">Never expires (Recommended for backend servers)</option>
                  <option value="30">Expires in 30 days</option>
                  <option value="90">Expires in 90 days</option>
                  <option value="365">Expires in 1 year</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#f3eee6]/10">
                <button
                  type="button"
                  onClick={() => setShowCreateKeyModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingKey}
                  className="px-5 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {creatingKey ? "Issuing..." : "Issue Key"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ONE-TIME REVEAL MODAL (Reused Component) */}
      {revealedKeyData && (
        <ApiKeyRevealModal
          rawKey={revealedKeyData.rawKey}
          name={revealedKeyData.name}
          environment={revealedKeyData.environment}
          onClose={() => setRevealedKeyData(null)}
        />
      )}
    </div>
  );
};
