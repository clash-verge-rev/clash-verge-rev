/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/index.html",
    "./src/splashscreen.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "var(--mui-palette-primary-main)",
        secondary: "var(--mui-palette-secondary-main)",
        error: "var(--mui-palette-error-main)",
      },
      textColor: {
        primary: "var(--mui-palette-text-primary)",
        secondary: "var(--mui-palette-text-secondary)",
      },
      backgroundColor: {
        primary: "var(--mui-palette-primary-main)",
        alpha: "var(--background-color-alpha)",
        comment: "#f0f0f0",
        "dark-comment": "#2e303d",
      },
      divideColor: {
        primary: "rgba(0, 0, 0, 0.06)",
        "dark-primary": "rgba(255, 255, 255, 0.06)",
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
  important: "#root",
};
