/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,svelte}'],
  theme: {
    extend: {
      colors: {
        'fesk-blue': '#1e40af',
        'fesk-cyan': '#0891b2',
        'fesk-emerald': '#059669',
        'fesk-amber': '#d97706',
        'fesk-red': '#dc2626'
      },
      fontFamily: {
        'mono': ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace']
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography')
  ],
}