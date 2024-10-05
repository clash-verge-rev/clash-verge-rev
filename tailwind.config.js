/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/index.html",
    "./src/splashscreen.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
  important: "#root",
};
