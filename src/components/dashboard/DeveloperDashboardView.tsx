import React, { useState, useEffect } from "react";
import {
  Key,
  Globe,
  Shield,
  RotateCw,
  Trash2,
  Plus,
  Copy,
  Check,
  Building,
  ArrowLeft,
  RefreshCw,
  ExternalLink,
  Lock,
  Calendar,
  AlertCircle,
  FileText,
  Settings,
  ChevronDown,
  Webhook,
  BarChart3,
  BookOpen,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { CreateApiKeyModal } from "./CreateApiKeyModal";
import { ApiKeyRevealModal } from "./ApiKeyRevealModal";
import { CreateAppModal } from "./CreateAppModal";
import { CreateOrgModal } from "./CreateOrgModal";
import { WebhookManagementTab } from "./WebhookManagementTab";
import { UsageAnalyticsTab } from "./UsageAnalyticsTab";
import { QuickstartDocsTab } from "./QuickstartDocsTab";
import { SsoManagementTab } from "./SsoManagementTab";
import { API_BASE } from "../../lib/apiConfig";

interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: string;
  settings: any;
  createdAt: string;
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

interface CustomerApp {
  id: string;
  organizationId: string;
  appName: string;
  allowedDomains: string[];
  branding: {
    logoUrl?: string;
    primaryColor?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface AuditLog {
  id: string;
  organization_id: string;
  api_key_id: string | null;
  action: string;
  actor_id: string;
  key_prefix: string | null;
  metadata: any;
  ip_address: string | null;
  created_at: string;
}

interface DeveloperDashboardViewProps {
  onBackToHome: () => void;
}

export const DeveloperDashboardView: React.FC<DeveloperDashboardViewProps> = ({
  onBackToHome,
}) => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [activeTab, setActiveTab] = useState<
    "keys" | "apps" | "webhooks" | "sso" | "usage" | "quickstart" | "audit"
  >("keys");

  // State collections
  const [apiKeys, setApiKeys] = useState<MaskedApiKey[]>([]);
  const [apps, setApps] = useState<CustomerApp[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Modals state
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
  const [showCreateAppModal, setShowCreateAppModal] = useState(false);
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [revealedKeyData, setRevealedKeyData] = useState<{
    rawKey: string;
    name: string;
    environment: "live" | "test";
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const [isSuperadmin, setIsSuperadmin] = useState(false);

  const token = localStorage.getItem("mathsy_meet_token");

  const getHeaders = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  useEffect(() => {
    fetch(`${API_BASE}/admin/check`, { headers: getHeaders() })
      .then((res) => (res.ok ? res.json() : { isSuperadmin: false }))
      .then((data) => setIsSuperadmin(Boolean(data.isSuperadmin)))
      .catch(() => setIsSuperadmin(false));
  }, []);

  // 1. Fetch user organizations
  const fetchOrganizations = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/organizations`, { headers: getHeaders() });
      if (!res.ok) {
        throw new Error("Failed to load organizations");
      }
      const data = await res.json();
      const orgs: Organization[] = data.organizations || [];
      setOrganizations(orgs);
      if (orgs.length > 0) {
        // Keep selected if exists, otherwise first
        setSelectedOrg((curr) => {
          if (curr) {
            const found = orgs.find((o) => o.id === curr.id);
            if (found) return found;
          }
          return orgs[0];
        });
      } else {
        setSelectedOrg(null);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Could not load developer organizations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrganizations();
  }, []);

  // 2. Fetch data for selected organization
  const fetchOrgData = async () => {
    if (!selectedOrg) return;
    try {
      // Keys
      const keysRes = await fetch(`${API_BASE}/organizations/${selectedOrg.id}/keys`, {
        headers: getHeaders(),
      });
      if (keysRes.ok) {
        const data = await keysRes.json();
        setApiKeys(data.keys || []);
      }

      // Apps
      const appsRes = await fetch(`${API_BASE}/organizations/${selectedOrg.id}/apps`, {
        headers: getHeaders(),
      });
      if (appsRes.ok) {
        const data = await appsRes.json();
        setApps(data.apps || []);
      }

      // Audit Logs
      const auditRes = await fetch(`${API_BASE}/organizations/${selectedOrg.id}/keys/audit`, {
        headers: getHeaders(),
      });
      if (auditRes.ok) {
        const data = await auditRes.json();
        setAuditLogs(data.auditLogs || []);
      }
    } catch (err: any) {
      console.error("Error fetching org credentials:", err);
    }
  };

  useEffect(() => {
    if (selectedOrg) {
      fetchOrgData();
    }
  }, [selectedOrg]);

  // Handlers
  const handleKeyCreated = (rawKey: string, keyName: string, environment: "live" | "test") => {
    setShowCreateKeyModal(false);
    setRevealedKeyData({ rawKey, name: keyName, environment });
    fetchOrgData();
  };

  const handleRotateKey = async (key: MaskedApiKey) => {
    if (!selectedOrg) return;
    const confirmRotate = window.confirm(
      `Are you sure you want to rotate "${key.name}"? The current key will be revoked immediately.`
    );
    if (!confirmRotate) return;

    setActionLoadingId(key.id);
    try {
      const res = await fetch(`${API_BASE}/organizations/${selectedOrg.id}/keys/${key.id}/rotate`, {
        method: "POST",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to rotate key");
      }
      toast.success("API key rotated successfully");
      setRevealedKeyData({
        rawKey: data.rawKey,
        name: key.name,
        environment: key.environment,
      });
      fetchOrgData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRevokeKey = async (key: MaskedApiKey) => {
    if (!selectedOrg) return;
    const confirmRevoke = window.confirm(
      `Revoke "${key.name}"? Any backend service using this key will immediately be rejected.`
    );
    if (!confirmRevoke) return;

    setActionLoadingId(key.id);
    try {
      const res = await fetch(`${API_BASE}/organizations/${selectedOrg.id}/keys/${key.id}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to revoke key");
      }
      toast.success("API key revoked");
      fetchOrgData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteApp = async (app: CustomerApp) => {
    if (!selectedOrg) return;
    const confirmDelete = window.confirm(
      `Delete application "${app.appName}"? Embeds from its configured domains may be blocked.`
    );
    if (!confirmDelete) return;

    try {
      const res = await fetch(`${API_BASE}/organizations/${selectedOrg.id}/apps/${app.id}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (!res.ok) {
        throw new Error("Failed to delete application");
      }
      toast.success("Application deleted");
      fetchOrgData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
    toast.info("Copied to clipboard");
  };

  return (
    <div className="min-h-screen bg-[#0e0d0b] text-[#f3eee6] flex flex-col selection:bg-[#f59e0b]/30">
      {/* Modals */}
      {showCreateKeyModal && selectedOrg && (
        <CreateApiKeyModal
          orgId={selectedOrg.id}
          onSuccess={handleKeyCreated}
          onClose={() => setShowCreateKeyModal(false)}
        />
      )}

      {showCreateAppModal && selectedOrg && (
        <CreateAppModal
          orgId={selectedOrg.id}
          onSuccess={() => {
            setShowCreateAppModal(false);
            fetchOrgData();
          }}
          onClose={() => setShowCreateAppModal(false)}
        />
      )}

      {showCreateOrgModal && (
        <CreateOrgModal
          onSuccess={(newOrg) => {
            setShowCreateOrgModal(false);
            fetchOrganizations();
          }}
          onClose={() => setShowCreateOrgModal(false)}
        />
      )}

      {revealedKeyData && (
        <ApiKeyRevealModal
          rawKey={revealedKeyData.rawKey}
          name={revealedKeyData.name}
          environment={revealedKeyData.environment}
          onClose={() => setRevealedKeyData(null)}
        />
      )}

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 px-6 lg:px-12 h-16 flex items-center justify-between bg-[#0e0d0b]/90 backdrop-blur-md border-b border-[#f3eee6]/10">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToHome}
            className="flex items-center gap-2 text-xs font-medium text-[#a39e94] hover:text-[#f3eee6] px-2.5 py-1.5 rounded-lg hover:bg-[#1a1814] transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Meetings</span>
          </button>

          <div className="h-4 w-px bg-[#f3eee6]/15" />

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#f59e0b] to-[#d97706] text-[#0e0d0b] flex items-center justify-center font-bold shadow-md shadow-[#f59e0b]/20">
              <Key className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-sm tracking-tight text-[#f3eee6]">
              Developer<span className="text-[#f59e0b]">Console</span>
            </span>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">
              Phase 4 SaaS
            </span>
          </div>
        </div>

        {/* Organization Switcher */}
        <div className="flex items-center gap-3">
          {organizations.length > 0 ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={selectedOrg?.id || ""}
                  onChange={(e) => {
                    const found = organizations.find((o) => o.id === e.target.value);
                    if (found) setSelectedOrg(found);
                  }}
                  className="bg-[#1a1814] border border-[#f3eee6]/15 rounded-xl px-3 py-1.5 text-xs text-[#f3eee6] font-medium pr-8 focus:outline-none focus:border-[#f59e0b] cursor-pointer appearance-none"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.role})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#a39e94] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              <button
                onClick={() => setShowCreateOrgModal(true)}
                title="Create New Organization"
                className="p-1.5 rounded-xl bg-[#1a1814] hover:bg-[#25221c] border border-[#f3eee6]/15 text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCreateOrgModal(true)}
              className="px-3 py-1.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] text-xs font-bold transition flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Organization
            </button>
          )}

          {isSuperadmin && (
            <button
              onClick={() => {
                window.history.pushState({}, "", "/admin");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              title="Open Platform Superadmin Console"
              className="px-2.5 py-1.5 rounded-xl bg-[#f59e0b]/15 hover:bg-[#f59e0b]/25 border border-[#f59e0b]/30 text-[#f59e0b] text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Platform Admin</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 lg:p-10 space-y-6">
        {/* If no organizations */}
        {!loading && organizations.length === 0 ? (
          <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-3xl p-12 text-center max-w-lg mx-auto mt-12 shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-[#f59e0b]/10 text-[#f59e0b] flex items-center justify-center mx-auto mb-5 border border-[#f59e0b]/20">
              <Building className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-[#f3eee6] mb-2">Create Your Organization</h2>
            <p className="text-xs text-[#a39e94] mb-6 leading-relaxed">
              To generate API keys, configure allowed embed domains, and integrate Mathsy Meet into your web application, setup your organization workspace.
            </p>
            <button
              onClick={() => setShowCreateOrgModal(true)}
              className="px-6 py-3 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition shadow-lg shadow-[#f59e0b]/25 inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create Organization Workspace
            </button>
          </div>
        ) : (
          <>
            {/* Header / Context Strip */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-5">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-lg font-bold text-[#f3eee6]">{selectedOrg?.name}</h1>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[#10b981]/10 text-[#34d399] border border-[#10b981]/20 font-semibold">
                    {selectedOrg?.status}
                  </span>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[#f3eee6]/10 text-[#a39e94] border border-[#f3eee6]/15">
                    Role: {selectedOrg?.role}
                  </span>
                </div>
                <p className="text-xs text-[#a39e94] mt-1 font-mono">
                  Tenant ID: <span className="text-[#f3eee6]">{selectedOrg?.id}</span>
                </p>
              </div>

              {/* Navigation Tabs */}
              <div className="flex items-center gap-1 bg-[#0a0907] border border-[#f3eee6]/10 p-1 rounded-xl self-start sm:self-auto flex-wrap">
                <button
                  onClick={() => setActiveTab("keys")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
                    activeTab === "keys"
                      ? "bg-[#f59e0b] text-[#0e0d0b] shadow-md shadow-[#f59e0b]/20"
                      : "text-[#a39e94] hover:text-[#f3eee6]"
                  }`}
                >
                  <Key className="w-3.5 h-3.5" />
                  API Keys ({apiKeys.filter((k) => k.is_active).length})
                </button>

                <button
                  onClick={() => setActiveTab("apps")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
                    activeTab === "apps"
                      ? "bg-[#f59e0b] text-[#0e0d0b] shadow-md shadow-[#f59e0b]/20"
                      : "text-[#a39e94] hover:text-[#f3eee6]"
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  Allowed Domains ({apps.length})
                </button>

                <button
                  onClick={() => setActiveTab("sso")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
                    activeTab === "sso"
                      ? "bg-[#f59e0b] text-[#0e0d0b] shadow-md shadow-[#f59e0b]/20"
                      : "text-[#a39e94] hover:text-[#f3eee6]"
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  SSO & Provisioning
                </button>

                <button
                  onClick={() => setActiveTab("webhooks")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
                    activeTab === "webhooks"
                      ? "bg-[#f59e0b] text-[#0e0d0b] shadow-md shadow-[#f59e0b]/20"
                      : "text-[#a39e94] hover:text-[#f3eee6]"
                  }`}
                >
                  <Webhook className="w-3.5 h-3.5" />
                  Webhooks
                </button>

                <button
                  onClick={() => setActiveTab("usage")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
                    activeTab === "usage"
                      ? "bg-[#f59e0b] text-[#0e0d0b] shadow-md shadow-[#f59e0b]/20"
                      : "text-[#a39e94] hover:text-[#f3eee6]"
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Usage & Metering
                </button>

                <button
                  onClick={() => setActiveTab("quickstart")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
                    activeTab === "quickstart"
                      ? "bg-[#f59e0b] text-[#0e0d0b] shadow-md shadow-[#f59e0b]/20"
                      : "text-[#a39e94] hover:text-[#f3eee6]"
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  Quickstart SDK
                </button>

                <button
                  onClick={() => setActiveTab("audit")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
                    activeTab === "audit"
                      ? "bg-[#f59e0b] text-[#0e0d0b] shadow-md shadow-[#f59e0b]/20"
                      : "text-[#a39e94] hover:text-[#f3eee6]"
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  Audit Trail
                </button>
              </div>
            </div>

            {/* TAB 1: API KEYS */}
            {activeTab === "keys" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-[#f3eee6]">Server-to-Server Credentials</h2>
                    <p className="text-xs text-[#a39e94]">High-entropy keys for room creation and participant token minting</p>
                  </div>

                  <button
                    onClick={() => setShowCreateKeyModal(true)}
                    className="px-4 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer flex items-center gap-2 shadow-lg shadow-[#f59e0b]/20"
                  >
                    <Plus className="w-4 h-4" />
                    Generate New Key
                  </button>
                </div>

                {apiKeys.length === 0 ? (
                  <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-8 text-center">
                    <Key className="w-8 h-8 text-[#a39e94] mx-auto mb-3" />
                    <p className="text-xs font-medium text-[#f3eee6]">No API keys created yet</p>
                    <p className="text-[11px] text-[#a39e94] mt-1">Generate your first key to begin using the B2B REST API.</p>
                  </div>
                ) : (
                  <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#0a0907] border-b border-[#f3eee6]/10 text-[11px] font-semibold text-[#a39e94]">
                        <tr>
                          <th className="py-3 px-4">Name</th>
                          <th className="py-3 px-4">Key Secret</th>
                          <th className="py-3 px-4">Environment</th>
                          <th className="py-3 px-4">Permissions</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Created</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f3eee6]/[0.06]">
                        {apiKeys.map((key) => (
                          <tr key={key.id} className="hover:bg-[#1a1814]/50 transition">
                            <td className="py-3.5 px-4 font-semibold text-[#f3eee6]">{key.name}</td>
                            <td className="py-3.5 px-4 font-mono text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-[#a39e94]">{key.masked_key}</span>
                                <button
                                  onClick={() => copyToClipboard(key.key_prefix, key.id)}
                                  title="Copy Key Prefix"
                                  className="text-[#a39e94] hover:text-[#f3eee6] transition"
                                >
                                  {copiedKeyId === key.id ? (
                                    <Check className="w-3.5 h-3.5 text-[#34d399]" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
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
                            <td className="py-3.5 px-4">
                              <div className="flex flex-wrap gap-1">
                                {key.permissions.map((p) => (
                                  <span
                                    key={p}
                                    className="text-[10px] font-mono bg-[#0a0907] border border-[#f3eee6]/15 px-1.5 py-0.5 rounded text-[#a39e94]"
                                  >
                                    {p}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
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
                            <td className="py-3.5 px-4 text-[#a39e94] text-[11px]">
                              {new Date(key.created_at).toLocaleDateString()}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              {key.is_active ? (
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => handleRotateKey(key)}
                                    disabled={actionLoadingId === key.id}
                                    title="Rotate Key"
                                    className="p-1.5 rounded-lg bg-[#0a0907] hover:bg-[#25221c] border border-[#f3eee6]/15 text-[#a39e94] hover:text-[#f59e0b] transition cursor-pointer"
                                  >
                                    <RotateCw className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleRevokeKey(key)}
                                    disabled={actionLoadingId === key.id}
                                    title="Revoke Key"
                                    className="p-1.5 rounded-lg bg-[#0a0907] hover:bg-[#ef4444]/20 border border-[#f3eee6]/15 text-[#a39e94] hover:text-[#ef4444] transition cursor-pointer"
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
            )}

            {/* TAB 2: ALLOWED DOMAINS & APPS */}
            {activeTab === "apps" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-[#f3eee6]">Whitelisted Embed Origins</h2>
                    <p className="text-xs text-[#a39e94]">
                      Control which domains are allowed to iframe embed your video meetings via CSP frame-ancestors
                    </p>
                  </div>

                  <button
                    onClick={() => setShowCreateAppModal(true)}
                    className="px-4 py-2 rounded-xl bg-[#3b82f6] hover:bg-[#2563eb] text-white font-bold text-xs transition cursor-pointer flex items-center gap-2 shadow-lg shadow-[#3b82f6]/20"
                  >
                    <Plus className="w-4 h-4" />
                    Register Application
                  </button>
                </div>

                {apps.length === 0 ? (
                  <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-8 text-center">
                    <Globe className="w-8 h-8 text-[#a39e94] mx-auto mb-3" />
                    <p className="text-xs font-medium text-[#f3eee6]">No customer apps configured</p>
                    <p className="text-[11px] text-[#a39e94] mt-1">
                      Register your application to whitelist embedding origins for the SDK.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {apps.map((app) => (
                      <div
                        key={app.id}
                        className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-5 space-y-4 relative"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-md"
                              style={{ backgroundColor: app.branding?.primaryColor || "#4f46e5" }}
                            >
                              {app.appName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <h3 className="font-bold text-sm text-[#f3eee6]">{app.appName}</h3>
                              <span className="text-[10px] text-[#a39e94]">
                                Registered {new Date(app.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>

                          <button
                            onClick={() => handleDeleteApp(app)}
                            className="p-1.5 rounded-lg bg-[#0a0907] hover:bg-[#ef4444]/20 border border-[#f3eee6]/10 text-[#a39e94] hover:text-[#ef4444] transition cursor-pointer"
                            title="Delete App"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-[#a39e94] mb-2 block">
                            Whitelisted Parent Domains ({app.allowedDomains.length})
                          </label>
                          {app.allowedDomains.length === 0 ? (
                            <span className="text-xs text-[#a39e94] italic">None configured (embeds restricted to 'self')</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {app.allowedDomains.map((domain) => (
                                <span
                                  key={domain}
                                  className="text-xs font-mono bg-[#0a0907] border border-[#f3eee6]/15 px-2.5 py-1 rounded-lg text-[#34d399] flex items-center gap-1"
                                >
                                  <Globe className="w-3 h-3 text-[#10b981]" />
                                  {domain}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: AUDIT TRAIL */}
            {activeTab === "audit" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-[#f3eee6]">Immutable Audit Logs</h2>
                  <p className="text-xs text-[#a39e94]">Historical security record of credential lifecycle events</p>
                </div>

                {auditLogs.length === 0 ? (
                  <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-8 text-center">
                    <Shield className="w-8 h-8 text-[#a39e94] mx-auto mb-3" />
                    <p className="text-xs font-medium text-[#f3eee6]">No audit logs recorded yet</p>
                  </div>
                ) : (
                  <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#0a0907] border-b border-[#f3eee6]/10 text-[11px] font-semibold text-[#a39e94]">
                        <tr>
                          <th className="py-3 px-4">Event</th>
                          <th className="py-3 px-4">Key Prefix</th>
                          <th className="py-3 px-4">Actor</th>
                          <th className="py-3 px-4">Timestamp</th>
                          <th className="py-3 px-4">IP Address</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f3eee6]/[0.06]">
                        {auditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-[#1a1814]/50 transition">
                            <td className="py-3 px-4">
                              <span
                                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-semibold ${
                                  log.action === "created"
                                    ? "bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/30"
                                    : log.action === "rotated"
                                    ? "bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30"
                                    : log.action === "revoked"
                                    ? "bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/30"
                                    : "bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/30"
                                }`}
                              >
                                {log.action}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-[#f3eee6]">
                              {log.key_prefix || "—"}
                            </td>
                            <td className="py-3 px-4 text-[#a39e94] text-[11px] font-mono">
                              {log.actor_id}
                            </td>
                            <td className="py-3 px-4 text-[#a39e94] text-[11px]">
                              {new Date(log.created_at).toLocaleString()}
                            </td>
                            <td className="py-3 px-4 text-[#a39e94] font-mono text-[11px]">
                              {log.ip_address || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB: SSO & PROVISIONING */}
            {activeTab === "sso" && selectedOrg && (
              <SsoManagementTab
                organizationId={selectedOrg.id}
                organizationRole={selectedOrg.role}
              />
            )}

            {/* TAB 4: WEBHOOKS */}
            {activeTab === "webhooks" && selectedOrg && (
              <WebhookManagementTab orgId={selectedOrg.id} />
            )}

            {/* TAB 5: USAGE & LEDGER */}
            {activeTab === "usage" && selectedOrg && (
              <UsageAnalyticsTab orgId={selectedOrg.id} />
            )}

            {/* TAB 6: QUICKSTART & SDK */}
            {activeTab === "quickstart" && selectedOrg && (
              <QuickstartDocsTab orgId={selectedOrg.id} />
            )}
          </>
        )}
      </main>
    </div>
  );
};
