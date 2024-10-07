/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/index.html",
    "./src/splashscreen.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    screens: {
      xs: "0px",
      sm: "650px",
      md: "900px",
      lg: "1200px",
      xl: "1536px",
    },
    extend: {
      colors: {
        "primary-main": "var(--mui-palette-primary-main)",
        "secondary-main": "var(--mui-palette-secondary-main)",
        "error-main": "var(--mui-palette-error-main)",
      },
      textColor: {
        "primary-main": "var(--mui-palette-primary-main)",
        "secondary-main": "var(--mui-palette-secondary-main)",
        "error-main": "var(--mui-palette-error-main)",
        primary: "var(--mui-palette-text-primary)",
        secondary: "var(--mui-palette-text-secondary)",
      },
      backgroundColor: {
        primary: "var(--mui-palette-primary-main)",
        alpha: "var(--background-color-alpha)",
        comment: "var(--background-color)",
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
