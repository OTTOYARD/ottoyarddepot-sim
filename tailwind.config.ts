import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        'otto-charcoal': '#2D2D2D',
        'otto-red': '#C00000',
        'otto-teal': '#00B4A6',
        'otto-amber': '#F59E0B',
        'otto-white': '#FFFFFF',
        'otto-gray': '#666666',
        'otto-dark': '#1A1A2E',

        // ── OTTO-TWIN Command Center design system (OTTOYARD brand + restrained-instrument) ──
        // See OTTOQ_DESIGN_SYSTEM.md. Migrate components off otto-* onto these over phases.
        canvas: { base: '#06070A', raised: '#0A0B0E', panel: '#111317', elev: '#14161A', line2: '#1A1C22' },
        // ink.faint WAS #4A4E57 and ink.dim WAS #8A8F99. Measured against
        // canvas.panel (#111317), the surface almost every panel draws on, that
        // put faint at **2.23:1** -- roughly half the WCAG AA floor of 4.5:1 --
        // and it carries 176 `text-ink-faint` uses, most of them at 8-9px. Chase,
        // 2026-09-22: "a lot of the text within the controls tab is hard to read
        // ... dark gray text over top of the dark or charcoal background."
        // Re-measured on the new values: DEFAULT 15.4:1, dim 8.4:1, faint 4.8:1 --
        // still a clean three-step hierarchy, now with every step above AA.
        ink:    { DEFAULT: '#E7EAF0', dim: '#A8AEBB', faint: '#7B818D' },
        brand:  { red: '#C8102E', deep: '#8E0B20', hot: '#E8293F' },
        state:  { go: '#C9E0D4', info: '#D8DDFF', warn: '#FFEBC9', crit: '#FF8A80' },
      },
      fontFamily: {
        display: ['"Chakra Petch"', 'system-ui', 'sans-serif'],
        ui:      ['"Inter Tight"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
