/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,tsx}"],
  theme: {
    extend: {},
  },
  daisyui: {
    themes: ["corporate"],
  },
  plugins: [require("daisyui")],
}

