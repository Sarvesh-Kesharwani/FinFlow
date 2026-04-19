import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Duolingo-inspired palette
        duo: {
          green: '#58CC02',
          greenDark: '#58A700',
          blue: '#1CB0F6',
          blueDark: '#0A8CC7',
          yellow: '#FFC800',
          red: '#FF4B4B',
          purple: '#CE82FF',
          bg: '#FFFFFF',
          soft: '#F7F7F7',
          ink: '#3C3C3C',
          mute: '#AFAFAF',
          border: '#E5E5E5',
        },
      },
      borderRadius: {
        chonk: '1.25rem',
      },
      boxShadow: {
        // chunky bottom-shadow button signature
        duo: '0 4px 0 0 rgba(0,0,0,0.15)',
        duoGreen: '0 4px 0 0 #58A700',
        duoBlue: '0 4px 0 0 #0A8CC7',
        card: '0 2px 0 0 #E5E5E5',
      },
      fontFamily: {
        display: ['"Nunito"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
