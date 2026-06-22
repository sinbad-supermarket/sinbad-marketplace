import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172026",
        line: "#d9dee2",
        panel: "#f7f8f8"
      }
    }
  },
  plugins: []
};

export default config;
