import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generates a clean Google Meet style meeting code: e.g. "abc-defg-hij"
 */
export function generateMeetingCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const part1 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const part2 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const part3 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${part1}-${part2}-${part3}`;
}

/**
 * Normalizes user input into valid meeting room ID
 */
export function sanitizeRoomId(input: string): string {
  if (!input) return "";
  const cleaned = input.trim().toLowerCase();
  // If user pasted a full URL
  if (cleaned.includes("/meet/")) {
    return cleaned.split("/meet/")[1].split("?")[0].replace(/[^a-z0-9-]/g, "");
  }
  return cleaned.replace(/[^a-z0-9-]/g, "");
}
