/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        brand: {
          bg: "#0e0d0b",
          surface: "#1a1814",
          surface2: "#221f1a",
          border: "rgba(243, 238, 230, 0.08)",
          text: "#f3eee6",
          muted: "#a39e94",
          accent: "#f59e0b",
          accentDim: "rgba(245, 158, 11, 0.12)",
          accentGlow: "rgba(245, 158, 11, 0.35)",
        },
        meet: {
          dark: "#1a1814",
          darker: "#0e0d0b",
          surface: "#1a1814",
          surface2: "#221f1a",
          gray: "#28251f",
          lightgray: "#a39e94",
          blue: "#f59e0b",
          hoverBlue: "#d97706",
          red: "#dc2626",
          green: "#10b981",
          yellow: "#f59e0b"
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "float-up": {
          "0%": { transform: "translateY(0) scale(0.8)", opacity: "1" },
          "100%": { transform: "translateY(-180px) scale(1.4)", opacity: "0" }
        },
        "wave-pulse": {
          "0%, 100%": { height: "4px" },
          "50%": { height: "16px" }
        }
      },
      animation: {
        "float-up": "float-up 2.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards",
        "wave-pulse": "wave-pulse 0.8s ease-in-out infinite"
      }
    },
  },
  plugins: [],
}
