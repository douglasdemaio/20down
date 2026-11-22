/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0c10",
          900: "#0f131b",
          800: "#161c27",
          700: "#1e2735",
          600: "#2a3547",
        },
        brass: {
          300: "#f2d9a0",
          400: "#e6c179",
          500: "#d4a84f",
          600: "#b5873a",
        },
        coral: {
          400: "#f08a6c",
          500: "#e26d4e",
          600: "#c45236",
        },
        felt: {
          500: "#1d6b52",
          600: "#175745",
          700: "#123f33",
        },
        parchment: {
          100: "#f7f0e1",
          200: "#efe4cd",
        },
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', '"Book Antiqua"', "Georgia", "serif"],
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', "Roboto", "sans-serif"],
        mono: ['ui-monospace', '"SF Mono"', '"Cascadia Code"', '"Roboto Mono"', "monospace"],
      },
      boxShadow: {
        card: "0 24px 60px -30px rgba(0,0,0,0.7)",
        raised: "inset 0 -6px 12px rgba(0,0,0,0.25), 0 10px 20px -12px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "felt-radial": "radial-gradient(circle at 50% 20%, rgba(45,143,109,0.35), transparent 65%)",
      },
    },
  },
  plugins: [],
};
