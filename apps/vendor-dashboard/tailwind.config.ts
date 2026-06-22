import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172026",
        panel: "#eef1f3",
        line: "#d8dee3",
        muted: "#65717d"
      }
    }
  },
  plugins: []
};

export default config;
