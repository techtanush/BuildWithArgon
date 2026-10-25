import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base "./" so the build works under /preview/<venture>/<ticket>/
export default defineConfig({
  base: './',
  plugins: [react()],
});
