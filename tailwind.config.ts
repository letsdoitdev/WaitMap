import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        wait: {
          green: "#22c55e",
          blue: "#3b82f6",
          orange: "#f97316",
          red: "#ef4444",
          gray: "#9ca3af",
        },
      },
    },
  },
  plugins: [],
};
export default config;
