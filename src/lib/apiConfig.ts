/**
 * Unified API Configuration
 * Dynamically resolves the backend API Base URL without hardcoding.
 */
export const getApiBase = (): string => {
  const envUrl = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) || "";
  if (envUrl) {
    return envUrl.replace(/\/$/, "");
  }
  // Default to relative /api if not specified (will be handled by server/Vercel proxy)
  return "/api";
};

export const API_BASE = getApiBase();
