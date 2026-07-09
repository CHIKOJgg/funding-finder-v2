/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'telegram': {
          'blue': '#3390ec',
          'hover': '#297cd8',
          'light': '#f0f8ff',
        },
        'success': '#28a745',
        'danger': '#dc3545',
        'warning': '#ffc107',
      },
      fontFamily: {
        'sans': ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
