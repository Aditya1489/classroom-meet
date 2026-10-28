import React, { useState } from "react";
import {
  Code,
  Terminal,
  Copy,
  Check,
  AlertTriangle,
  Globe,
  Key,
  Layers,
  ExternalLink,
  ShieldAlert,
  Server,
  Laptop,
} from "lucide-react";
import { toast } from "sonner";

interface QuickstartDocsTabProps {
  orgId: string;
}

export const QuickstartDocsTab: React.FC<QuickstartDocsTabProps> = ({ orgId }) => {
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [packageManager, setPackageManager] = useState<"npm" | "pnpm" | "yarn">("npm");

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://api.mathsy.in";
  const apiEndpointUrl = `${baseUrl}/api/v1`;

  const copyToClipboard = async (snippetId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSnippet(snippetId);
      toast.success("Snippet copied to clipboard");
      setTimeout(() => setCopiedSnippet(null), 2500);
    } catch (err) {
      console.warn("Failed to copy code snippet", err);
    }
  };

  const installCommand =
    packageManager === "npm"
      ? "npm install @mathsy/meet-sdk"
      : packageManager === "pnpm"
      ? "pnpm add @mathsy/meet-sdk"
      : "yarn add @mathsy/meet-sdk";

  const serverSnippet = `import { MathsyMeetServerClient } from "@mathsy/meet-sdk/server";

// 1. Initialize server client with secret API key from environment
const client = new MathsyMeetServerClient({
  apiKey: process.env.MATHSY_MEET_API_KEY!, // e.g. sec_live_... or sec_test_...
  apiBaseUrl: "${apiEndpointUrl}",
});

// 2. Create a meeting room
const meeting = await client.createMeeting({
  title: "Grade 10 Calculus Live Session",
  settings: {
    default_camera_locked: false,
  },
});

console.log("Room Created:", meeting.roomCode);

// 3. Mint short-lived participant token for an authenticated user
const tokenResult = await client.createParticipantToken(meeting.roomCode, {
  participantId: "user_student_123",
  name: "Sarah Johnson",
  role: "student", // "tutor" | "student"
  expiresInSeconds: 14400, // 4 hours
});

// Send roomCode and participant token to your web frontend
return {
  roomCode: meeting.roomCode,
  token: tokenResult.token,
};`;

  const reactEmbedSnippet = `import React, { useState } from "react";
import { MathsyMeeting, MathsyMeetEmbedController } from "@mathsy/meet-sdk/react";

export const VirtualClassroom = ({ roomCode, token }: { roomCode: string; token: string }) => {
  const [controller, setController] = useState<MathsyMeetEmbedController | null>(null);

  return (
    <div className="w-full h-[700px] rounded-2xl overflow-hidden border border-gray-800">
      <MathsyMeeting
        roomCode={roomCode}
        token={token}
        embedBaseUrl="${baseUrl}"
        width="100%"
        height="100%"
        onControllerReady={(ctrl) => setController(ctrl)}
        onJoined={(p) => console.log("Joined meeting:", p)}
        onLeft={(e) => console.log("Left meeting:", e.reason)}
        onError={(err) => console.error("Meeting error:", err.code, err.message)}
      />
    </div>
  );
};`;

  const vanillaJsSnippet = `<!-- Meeting Container Element -->
<div id="mathsy-meet-container" style="width: 100%; height: 650px; border-radius: 12px; overflow: hidden;"></div>

<script type="module">
  import { embedMeeting } from "@mathsy/meet-sdk/browser";

  // 1. Retrieve roomCode and short-lived token from your secure backend
  const response = await fetch("/api/join-classroom");
  const { roomCode, token } = await response.json();

  // 2. Embed the classroom into the container
  const controller = embedMeeting({
    container: "#mathsy-meet-container",
    roomCode: roomCode,
    token: token,
    embedBaseUrl: "${baseUrl}",
    onReady: () => console.log("Mathsy Meet Ready"),
    onJoined: (participant) => console.log("Joined:", participant),
    onError: (err) => console.error("Embed Error:", err),
  });
</script>`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-sm font-bold text-[#f3eee6]">Integration Quickstart Guide</h2>
        <p className="text-xs text-[#a39e94]">
          Embed low-latency, zero-trust WebRTC video classrooms into your learning platform in minutes
        </p>
      </div>

      {/* Critical Zero-Trust Security Alert */}
      <div className="bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-2xl p-5 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-[#ef4444] shrink-0" />
          <h3 className="text-xs font-bold text-[#ef4444] uppercase tracking-wide">
            Zero-Trust Security Requirement
          </h3>
        </div>
        <p className="text-xs text-[#f3eee6] leading-relaxed">
          <span className="font-semibold text-[#ef4444]">Never expose secret API keys</span> (
          <code className="text-[#f59e0b] font-mono">sec_live_...</code> or{" "}
          <code className="text-[#f59e0b] font-mono">sec_test_...</code>) in client-side code, SPAs,
          mobile applications, or public Git repositories.
        </p>
        <p className="text-[11px] text-[#a39e94] leading-relaxed">
          Secret keys must be retained exclusively on your backend server. Your server creates rooms and mints short-lived (5m–24h) participant tokens. The frontend consumes only short-lived tokens transmitted via URL hash fragments (<code className="text-[#34d399] font-mono">#token=...</code>) to eliminate <code className="font-mono">Referer</code> header leakage.
        </p>
      </div>

      {/* Step 1: Configuration & Base URLs */}
      <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center font-bold text-xs">
            1
          </div>
          <div>
            <h3 className="text-xs font-bold text-[#f3eee6]">Control-Plane & Embed Base URLs</h3>
            <p className="text-[11px] text-[#a39e94]">
              Use these active endpoint targets for SDK initialization
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-xl p-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-[#a39e94] block uppercase font-mono">
                API Base URL (Server-Side)
              </span>
              <span className="font-mono text-xs text-[#34d399] font-semibold select-all">
                {apiEndpointUrl}
              </span>
            </div>
            <button
              onClick={() => copyToClipboard("api-base", apiEndpointUrl)}
              className="p-1.5 rounded-lg bg-[#1a1814] hover:bg-[#26221c] text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
              title="Copy API Base URL"
            >
              {copiedSnippet === "api-base" ? (
                <Check className="w-3.5 h-3.5 text-[#34d399]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-xl p-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-[#a39e94] block uppercase font-mono">
                Embed Base URL (Client-Side)
              </span>
              <span className="font-mono text-xs text-[#38bdf8] font-semibold select-all">
                {baseUrl}
              </span>
            </div>
            <button
              onClick={() => copyToClipboard("embed-base", baseUrl)}
              className="p-1.5 rounded-lg bg-[#1a1814] hover:bg-[#26221c] text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
              title="Copy Embed Base URL"
            >
              {copiedSnippet === "embed-base" ? (
                <Check className="w-3.5 h-3.5 text-[#34d399]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Step 2: Install SDK */}
      <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center font-bold text-xs">
              2
            </div>
            <div>
              <h3 className="text-xs font-bold text-[#f3eee6]">Install @mathsy/meet-sdk</h3>
              <p className="text-[11px] text-[#a39e94]">
                Install the official client & server integration library
              </p>
            </div>
          </div>

          {/* Package Manager Selector */}
          <div className="flex items-center gap-1 bg-[#0a0907] border border-[#f3eee6]/10 p-1 rounded-xl">
            {(["npm", "pnpm", "yarn"] as const).map((pm) => (
              <button
                key={pm}
                onClick={() => setPackageManager(pm)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition cursor-pointer ${
                  packageManager === pm
                    ? "bg-[#f59e0b] text-[#0e0d0b]"
                    : "text-[#a39e94] hover:text-[#f3eee6]"
                }`}
              >
                {pm}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[#0a0907] border border-[#f3eee6]/10 rounded-xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-xs text-[#f3eee6]">
            <Terminal className="w-4 h-4 text-[#a39e94]" />
            <span>{installCommand}</span>
          </div>
          <button
            onClick={() => copyToClipboard("install", installCommand)}
            className="p-1.5 rounded-lg bg-[#1a1814] hover:bg-[#26221c] text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
            title="Copy command"
          >
            {copiedSnippet === "install" ? (
              <Check className="w-3.5 h-3.5 text-[#34d399]" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Step 3: Backend Meeting Creation & Token Minting */}
      <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center font-bold text-xs">
              3
            </div>
            <div>
              <h3 className="text-xs font-bold text-[#f3eee6]">
                Server-Side: Room Creation & Token Minting
              </h3>
              <p className="text-[11px] text-[#a39e94]">
                Create a room and mint short-lived participant tokens using your secret API key
              </p>
            </div>
          </div>

          <button
            onClick={() => copyToClipboard("server-snippet", serverSnippet)}
            className="px-3 py-1.5 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#f3eee6] text-xs font-medium border border-[#f3eee6]/10 transition cursor-pointer flex items-center gap-1.5"
          >
            {copiedSnippet === "server-snippet" ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#34d399]" />
                <span className="text-[#34d399]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[#a39e94]" />
                <span>Copy TypeScript</span>
              </>
            )}
          </button>
        </div>

        <pre className="p-4 rounded-xl bg-[#0a0907] border border-[#f3eee6]/10 text-xs font-mono text-[#f3eee6] overflow-x-auto leading-relaxed">
          {serverSnippet}
        </pre>
      </div>

      {/* Step 4: Frontend Embed (React & Vanilla JS) */}
      <div className="bg-[#14120e] border border-[#f3eee6]/10 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center font-bold text-xs">
              4
            </div>
            <div>
              <h3 className="text-xs font-bold text-[#f3eee6]">
                Frontend: Embed Meeting Classroom
              </h3>
              <p className="text-[11px] text-[#a39e94]">
                Mount the interactive WebRTC meeting view inside your application
              </p>
            </div>
          </div>

          <button
            onClick={() => copyToClipboard("react-snippet", reactEmbedSnippet)}
            className="px-3 py-1.5 rounded-xl bg-[#1a1814] hover:bg-[#26221c] text-[#f3eee6] text-xs font-medium border border-[#f3eee6]/10 transition cursor-pointer flex items-center gap-1.5"
          >
            {copiedSnippet === "react-snippet" ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#34d399]" />
                <span className="text-[#34d399]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[#a39e94]" />
                <span>Copy React</span>
              </>
            )}
          </button>
        </div>

        {/* React Snippet */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#f59e0b]">
            <Laptop className="w-3.5 h-3.5" />
            <span>React (@mathsy/meet-sdk/react)</span>
          </div>
          <pre className="p-4 rounded-xl bg-[#0a0907] border border-[#f3eee6]/10 text-xs font-mono text-[#f3eee6] overflow-x-auto leading-relaxed">
            {reactEmbedSnippet}
          </pre>
        </div>

        {/* Vanilla JS Snippet */}
        <div className="space-y-2 pt-2 border-t border-[#f3eee6]/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#38bdf8]">
              <Globe className="w-3.5 h-3.5" />
              <span>Plain JavaScript / HTML (@mathsy/meet-sdk/browser)</span>
            </div>
            <button
              onClick={() => copyToClipboard("vanilla-snippet", vanillaJsSnippet)}
              className="p-1 rounded-lg bg-[#1a1814] hover:bg-[#26221c] text-[#a39e94] hover:text-[#f3eee6] transition cursor-pointer"
              title="Copy HTML snippet"
            >
              {copiedSnippet === "vanilla-snippet" ? (
                <Check className="w-3.5 h-3.5 text-[#34d399]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <pre className="p-4 rounded-xl bg-[#0a0907] border border-[#f3eee6]/10 text-xs font-mono text-[#f3eee6] overflow-x-auto leading-relaxed">
            {vanillaJsSnippet}
          </pre>
        </div>
      </div>
    </div>
  );
};
