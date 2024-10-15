/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
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
        "primary-alpha": "var(--background-color-alpha)",
        "secondary-main": "var(--mui-palette-secondary-main)",
        "error-main": "var(--mui-palette-error-main)",
      },
      textColor: {
        primary: "var(--mui-palette-text-primary)",
        secondary: "var(--mui-palette-text-secondary)",
      },
      backgroundColor: {
        primary: "var(--mui-palette-primary-main)",
        comment: "var(--background-color)",
      },
      divideColor: {
        primary: "var(--divide-color)",
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
  important: "#root",
};
