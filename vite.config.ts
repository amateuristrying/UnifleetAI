import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api/navixy': {
        target: 'https://api.navixy.com/v2',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/navixy/, ''),
        secure: false,
        ws: true
      },
      // ===== ZAMBIA APIs =====
      '/api/zambia/summary': {
        target: 'https://91r76oqquk.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zambia\/summary/, ''),
        secure: true,
      },
      '/api/zambia/assets': {
        target: 'https://ds16ac8znh.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zambia\/assets/, ''),
        secure: true,
      },
      '/api/zambia/movement': {
        target: 'https://76bfo56hol.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zambia\/movement/, ''),
        secure: true,
      },
      '/api/zambia/fuel': {
        target: 'https://fufmz5ihve.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zambia\/fuel/, ''),
        secure: true,
      },
      '/api/zambia/night': {
        target: 'https://b8wxy2cdzb.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zambia\/night/, ''),
        secure: true,
      },
      '/api/zambia/speed': {
        target: 'https://hg6ik4rxm7.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zambia\/speed/, ''),
        secure: true,
      },
      '/api/zambia/geofence': {
        target: 'https://eoa4peaw4d.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zambia\/geofence/, ''),
        secure: true,
      },
      '/api/zambia/vehiclewise': {
        target: 'https://nntlwpg28e.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zambia\/vehiclewise/, ''),
        secure: true,
      },
      // ===== TANZANIA APIs =====
      '/api/tanzania/summaryapi': {
        target: 'https://6s4huxb9i1.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tanzania\/summaryapi/, ''),
        secure: true,
      },
      '/api/tanzania/assets': {
        target: 'https://pjagc4397d.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tanzania\/assets/, ''),
        secure: true,
      },
      '/api/tanzania/movement': {
        target: 'https://jvpjgxnfxf.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tanzania\/movement/, ''),
        secure: true,
      },
      '/api/tanzania/fuel': {
        target: 'https://f53djzy7o9.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tanzania\/fuel/, ''),
        secure: true,
      },
      '/api/tanzania/night': {
        target: 'https://vofgulra92.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tanzania\/night/, ''),
        secure: true,
      },
      '/api/tanzania/speed': {
        target: 'https://v6279woeyl.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tanzania\/speed/, ''),
        secure: true,
      },
      '/api/tanzania/geofence': {
        target: 'https://zdcs5c36ac.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tanzania\/geofence/, ''),
        secure: true,
      },
      '/api/tanzania/vehiclewise': {
        target: 'https://jffvmywo20.execute-api.ap-south-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tanzania\/vehiclewise/, ''),
        secure: true,
      },
    }
  }
})
