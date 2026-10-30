import React, { useState, useEffect } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Check,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  UserCheck,
  UserX,
  Globe,
  Mail,
  UserPlus,
  AlertTriangle,
  Lock,
  Layers,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "../../lib/apiConfig";

interface SsoConfig {
  id: string;
  organizationId: string;
  ssoEnabled: boolean;
  defaultRole: "student" | "tutor";
  allowAutoProvisioning: boolean;
  enforceVerifiedDomain: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SsoDomain {
  id: string;
  organizationId: string;
  domainName: string;
  verified: boolean;
  createdAt: string;
}

interface SsoUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: "student" | "tutor";
  source: "manual_allowlist" | "domain_auto_provisioned";
  isActive: boolean;
  externalIssuer: string | null;
  externalSubject: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface SsoManagementTabProps {
  organizationId: string;
  organizationRole: string;
}

export const SsoManagementTab: React.FC<SsoManagementTabProps> = ({
  organizationId,
  organizationRole,
}) => {
  const isReadOnly = organizationRole === "member";

  // Configuration state
  const [config, setConfig] = useState<SsoConfig | null>(null);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [defaultRole, setDefaultRole] = useState<"student" | "tutor">("student");
  const [allowAutoProvisioning, setAllowAutoProvisioning] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Domains state
  const [domains, setDomains] = useState<SsoDomain[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [isAddingDomain, setIsAddingDomain] = useState(false);
  const [showAddDomainModal, setShowAddDomainModal] = useState(false);

  // Users state
  const [users, setUsers] = useState<SsoUser[]>([]);
  const [userCount, setUserCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<"student" | "tutor">("student");
  const [isAddingUser, setIsAddingUser] = useState(false);

  const [loading, setLoading] = useState(true);

  const token = typeof window !== "undefined" ? localStorage.getItem("mathsy_meet_token") : null;
  const getHeaders = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  // 1. Fetch initial configuration and domains
  const fetchConfigAndDomains = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/organizations/${organizationId}/sso/config`, {
        headers: getHeaders(),
      });
      if (!res.ok) {
        throw new Error("Failed to load SSO configuration");
      }
      const data = await res.json();
      setConfig(data.config);
      setSsoEnabled(data.config.ssoEnabled);
      setDefaultRole(data.config.defaultRole);
      setAllowAutoProvisioning(data.config.allowAutoProvisioning);
      setDomains(data.domains || []);
      setUserCount(data.userCount || 0);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to load SSO configuration");
    } finally {
      setLoading(false);
    }
  };

  // 2. Fetch users with search
  const fetchUsers = async (query = "") => {
    try {
      setLoadingUsers(true);
      const queryParam = query ? `?q=${encodeURIComponent(query)}` : "";
      const res = await fetch(`${API_BASE}/organizations/${organizationId}/sso/users${queryParam}`, {
        headers: getHeaders(),
      });
      if (!res.ok) {
        throw new Error("Failed to load SSO users");
      }
      const data = await res.json();
      setUsers(data.users || []);
      setUserCount(data.total || 0);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to load SSO users");
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchConfigAndDomains();
    fetchUsers();
  }, [organizationId]);

  // 3. Save SSO Configuration
  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      const res = await fetch(`${API_BASE}/organizations/${organizationId}/sso/config`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({
          ssoEnabled,
          defaultRole,
          allowAutoProvisioning,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save SSO configuration");
      }
      setConfig(data.config);
      toast.success("SSO settings saved successfully");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  // 4. Add Domain
  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDomain = newDomain.trim().toLowerCase().replace(/^https?:\/\//, "");
    if (!cleanDomain || !cleanDomain.includes(".")) {
      toast.error("Please enter a valid domain (e.g., mathsy.com)");
      return;
    }

    try {
      setIsAddingDomain(true);
      const res = await fetch(`${API_BASE}/organizations/${organizationId}/sso/domains`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ domain: cleanDomain }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to add domain");
      }
      setDomains((prev) => [data.domain, ...prev]);
      setNewDomain("");
      setShowAddDomainModal(false);
      toast.success(`Domain ${cleanDomain} added and verified`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsAddingDomain(false);
    }
  };

  // 5. Delete Domain
  const handleDeleteDomain = async (domainId: string, domainName: string) => {
    if (!window.confirm(`Are you sure you want to remove ${domainName}? Users from this domain will no longer be auto-provisioned.`)) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/organizations/${organizationId}/sso/domains/${domainId}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove domain");
      }
      setDomains((prev) => prev.filter((d) => d.id !== domainId));
      toast.success(`Domain ${domainName} removed`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 6. Add User to Allowlist
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.includes("@") || !newUserName.trim()) {
      toast.error("Please provide both a valid email and full name.");
      return;
    }

    try {
      setIsAddingUser(true);
      const res = await fetch(`${API_BASE}/organizations/${organizationId}/sso/users`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          email: newUserEmail.trim(),
          name: newUserName.trim(),
          role: newUserRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to add user to allowlist");
      }
      toast.success(`User ${data.user.email} added to allowlist`);
      setNewUserEmail("");
      setNewUserName("");
      setNewUserRole("student");
      setShowAddUserModal(false);
      fetchUsers(searchQuery);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsAddingUser(false);
    }
  };

  // 7. Toggle User Active Status (Revoke / Reactivate)
  const handleToggleUserStatus = async (user: SsoUser) => {
    const action = user.isActive ? "revoke access for" : "reactivate";
    if (!window.confirm(`Are you sure you want to ${action} ${user.email}?`)) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/organizations/${organizationId}/sso/users/${user.id}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update user status");
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? data.user : u)));
      toast.success(`User ${user.email} is now ${data.user.isActive ? "active" : "revoked"}`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 8. Change User Role
  const handleChangeRole = async (user: SsoUser, newRole: "student" | "tutor") => {
    try {
      const res = await fetch(`${API_BASE}/organizations/${organizationId}/sso/users/${user.id}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to change user role");
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? data.user : u)));
      toast.success(`Role for ${user.email} updated to ${newRole}`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 9. Delete User
  const handleDeleteUser = async (user: SsoUser) => {
    if (!window.confirm(`Permanently remove ${user.email} from the allowlist?`)) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/organizations/${organizationId}/sso/users/${user.id}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete user");
      }
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setUserCount((c) => Math.max(0, c - 1));
      toast.success(`User ${user.email} deleted`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-[#a39e94]">
        <RefreshCw className="w-8 h-8 animate-spin text-[#f59e0b] mb-3" />
        <p className="text-sm">Loading SSO security settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* SECTION 1: MASTER SSO CONFIGURATION */}
      <div className="p-6 rounded-2xl bg-[#14120e] border border-[#f3eee6]/10 shadow-lg space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#f3eee6]/10">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#f59e0b]" />
              <h2 className="text-base font-bold text-[#f3eee6]">Organization Single Sign-On (SSO)</h2>
              <span
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-semibold border ${
                  ssoEnabled
                    ? "bg-[#10b981]/15 text-[#34d399] border-[#10b981]/30"
                    : "bg-[#ef4444]/15 text-[#f87171] border-[#ef4444]/30"
                }`}
              >
                {ssoEnabled ? "SSO ACTIVE" : "SSO DISABLED"}
              </span>
            </div>
            <p className="text-xs text-[#a39e94] mt-1">
              Authenticate users directly from your platform using server-to-server launch tokens.
            </p>
          </div>

          {!isReadOnly && (
            <button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="px-4 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer flex items-center gap-2 self-start md:self-auto disabled:opacity-50"
            >
              {savingConfig ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Save SSO Configuration
            </button>
          )}
        </div>

        {/* Toggles & Options */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Toggle: Enable SSO */}
          <div className="p-4 rounded-xl bg-[#0e0d0b] border border-[#f3eee6]/10 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#f3eee6]">SSO Master Switch</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ssoEnabled}
                    onChange={(e) => setSsoEnabled(e.target.checked)}
                    disabled={isReadOnly}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#26231d] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#f59e0b]"></div>
                </label>
              </div>
              <p className="text-[11px] text-[#a39e94] mt-2">
                Enable or disable SSO launch token issuance and participant entry for this organization.
              </p>
            </div>
          </div>

          {/* Toggle: Automatic Domain Provisioning */}
          <div className="p-4 rounded-xl bg-[#0e0d0b] border border-[#f3eee6]/10 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#f3eee6]">Auto-Provisioning</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowAutoProvisioning}
                    onChange={(e) => setAllowAutoProvisioning(e.target.checked)}
                    disabled={isReadOnly}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#26231d] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#f59e0b]"></div>
                </label>
              </div>
              <p className="text-[11px] text-[#a39e94] mt-2">
                Automatically provision and grant access to users whose emails match verified organization domains.
              </p>
            </div>
          </div>

          {/* Default User Role */}
          <div className="p-4 rounded-xl bg-[#0e0d0b] border border-[#f3eee6]/10 flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold text-[#f3eee6]">Default Provisioned Role</span>
              <p className="text-[11px] text-[#a39e94] mt-1 mb-2">
                Role assigned to automatically provisioned users unless specified in the launch token.
              </p>
            </div>
            <select
              value={defaultRole}
              onChange={(e) => setDefaultRole(e.target.value as "student" | "tutor")}
              disabled={isReadOnly}
              className="w-full bg-[#14120e] border border-[#f3eee6]/15 rounded-lg px-2.5 py-1.5 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
            >
              <option value="student">Student (Standard participant)</option>
              <option value="tutor">Tutor (Classroom leader / presenter)</option>
            </select>
          </div>
        </div>
      </div>

      {/* SECTION 2: VERIFIED DOMAINS */}
      <div className="p-6 rounded-2xl bg-[#14120e] border border-[#f3eee6]/10 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#f3eee6] flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#f59e0b]" />
              Verified Email Domains ({domains.length})
            </h3>
            <p className="text-xs text-[#a39e94]">
              Users with emails ending in these domains can join without prior manual allowlisting when auto-provisioning is active.
            </p>
          </div>

          {!isReadOnly && (
            <button
              onClick={() => setShowAddDomainModal(true)}
              className="px-3 py-1.5 rounded-lg bg-[#f3eee6]/10 hover:bg-[#f3eee6]/15 text-[#f3eee6] text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-[#f59e0b]" />
              Add Domain
            </button>
          )}
        </div>

        {domains.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-[#0e0d0b] border border-[#f3eee6]/5">
            <Globe className="w-8 h-8 text-[#a39e94]/40 mx-auto mb-2" />
            <p className="text-xs text-[#a39e94]">No email domains configured yet.</p>
            <p className="text-[11px] text-[#a39e94]/70 mt-1">
              Add your institution's email domain (e.g. <code className="text-[#f59e0b]">mathsy.in</code>) to enable automatic student and tutor provisioning.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {domains.map((dom) => (
              <div
                key={dom.id}
                className="p-3.5 rounded-xl bg-[#0e0d0b] border border-[#f3eee6]/10 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#f3eee6]">@{dom.domainName}</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-[#10b981]/10 text-[#34d399] border border-[#10b981]/20">
                      VERIFIED
                    </span>
                  </div>
                  <span className="text-[10px] text-[#a39e94]/70 mt-0.5 block">
                    Added {new Date(dom.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {!isReadOnly && (
                  <button
                    onClick={() => handleDeleteDomain(dom.id, dom.domainName)}
                    className="p-1.5 text-[#a39e94] hover:text-[#ef4444] transition rounded-lg hover:bg-[#ef4444]/10 cursor-pointer"
                    title="Remove domain"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 3: USERS & ALLOWLIST */}
      <div className="p-6 rounded-2xl bg-[#14120e] border border-[#f3eee6]/10 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-[#f3eee6] flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#f59e0b]" />
              Provisioned Users & Allowlist ({userCount})
            </h3>
            <p className="text-xs text-[#a39e94]">
              Manage explicitly approved users and monitor automatically provisioned participants.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#a39e94] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search user by name or email..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  fetchUsers(e.target.value);
                }}
                className="bg-[#0e0d0b] border border-[#f3eee6]/15 rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#f3eee6] placeholder-[#a39e94]/60 focus:outline-none focus:border-[#f59e0b] w-56"
              />
            </div>

            {!isReadOnly && (
              <button
                onClick={() => setShowAddUserModal(true)}
                className="px-3 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add User
              </button>
            )}
          </div>
        </div>

        {/* Users Table */}
        <div className="overflow-x-auto rounded-xl border border-[#f3eee6]/10">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#0e0d0b] border-b border-[#f3eee6]/10 text-[#a39e94] font-semibold">
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Provision Source</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Last Login</th>
                {!isReadOnly && <th className="py-2.5 px-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f3eee6]/5 bg-[#14120e]">
              {loadingUsers ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#a39e94]">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-[#f59e0b]" />
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#a39e94]">
                    No users found matching query. Add approved users above.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-[#f3eee6]/[0.02] transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#f3eee6]">{u.name}</div>
                      <div className="text-[11px] text-[#a39e94] font-mono">{u.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      {isReadOnly ? (
                        <span className="font-mono uppercase text-[10px] px-2 py-0.5 rounded-full bg-[#f3eee6]/10 text-[#f3eee6]">
                          {u.role}
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) => handleChangeRole(u, e.target.value as "student" | "tutor")}
                          className="bg-[#0e0d0b] border border-[#f3eee6]/15 rounded px-2 py-1 text-[11px] font-mono text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                        >
                          <option value="student">student</option>
                          <option value="tutor">tutor</option>
                        </select>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                          u.source === "manual_allowlist"
                            ? "bg-[#3b82f6]/10 text-[#60a5fa] border-[#3b82f6]/20"
                            : "bg-[#8b5cf6]/10 text-[#c084fc] border-[#8b5cf6]/20"
                        }`}
                      >
                        {u.source === "manual_allowlist" ? "MANUAL ALLOWLIST" : "DOMAIN AUTO"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                          u.isActive
                            ? "bg-[#10b981]/10 text-[#34d399] border-[#10b981]/20"
                            : "bg-[#ef4444]/10 text-[#f87171] border-[#ef4444]/20"
                        }`}
                      >
                        {u.isActive ? "ACTIVE" : "REVOKED"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[#a39e94] text-[11px]">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                    </td>
                    {!isReadOnly && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleToggleUserStatus(u)}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition cursor-pointer border ${
                              u.isActive
                                ? "bg-[#ef4444]/10 text-[#f87171] border-[#ef4444]/20 hover:bg-[#ef4444]/20"
                                : "bg-[#10b981]/10 text-[#34d399] border-[#10b981]/20 hover:bg-[#10b981]/20"
                            }`}
                          >
                            {u.isActive ? "Revoke" : "Reactivate"}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="p-1.5 text-[#a39e94] hover:text-[#ef4444] rounded hover:bg-[#ef4444]/10 transition cursor-pointer"
                            title="Remove user"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: ADD VERIFIED DOMAIN */}
      {showAddDomainModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#14120e] border border-[#f3eee6]/15 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-[#f3eee6] flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#f59e0b]" />
              Add Verified Organization Domain
            </h3>
            <p className="text-xs text-[#a39e94]">
              Users authenticating with email addresses ending with this domain will automatically gain access.
            </p>

            <form onSubmit={handleAddDomain} className="space-y-4">
              <div>
                <label className="text-[11px] font-semibold text-[#a39e94] uppercase tracking-wider block mb-1">
                  Domain Name
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-[#a39e94]">@</span>
                  <input
                    type="text"
                    required
                    placeholder="company.com or university.edu"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    className="w-full bg-[#0e0d0b] border border-[#f3eee6]/15 rounded-xl pl-8 pr-4 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddDomainModal(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingDomain}
                  className="px-4 py-1.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isAddingDomain && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Verify & Add Domain
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD USER TO ALLOWLIST */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#14120e] border border-[#f3eee6]/15 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-[#f3eee6] flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-[#f59e0b]" />
              Add User to SSO Allowlist
            </h3>
            <p className="text-xs text-[#a39e94]">
              Manually authorize an individual user to launch meetings through SSO regardless of domain restrictions.
            </p>

            <form onSubmit={handleAddUser} className="space-y-3.5">
              <div>
                <label className="text-[11px] font-semibold text-[#a39e94] uppercase tracking-wider block mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="user@partner.org"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full bg-[#0e0d0b] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#a39e94] uppercase tracking-wider block mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="Jane Doe"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full bg-[#0e0d0b] border border-[#f3eee6]/15 rounded-xl px-3.5 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#a39e94] uppercase tracking-wider block mb-1">
                  Default Role
                </label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as "student" | "tutor")}
                  className="w-full bg-[#0e0d0b] border border-[#f3eee6]/15 rounded-xl px-3 py-2 text-xs text-[#f3eee6] focus:outline-none focus:border-[#f59e0b]"
                >
                  <option value="student">Student (Attendee)</option>
                  <option value="tutor">Tutor (Host / Presenter)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingUser}
                  className="px-4 py-1.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-[#0e0d0b] font-bold text-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isAddingUser && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Add User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

