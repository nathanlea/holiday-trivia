import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@shared': path.resolve(__dirname, '../shared'),
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        // Minify for production
        minify: 'esbuild',
        // Chunk splitting for better caching
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom', 'react-router-dom'],
                },
            },
        },
    },
    server: {
        port: 8000,
        host: '0.0.0.0',
        allowedHosts: ['garminholidaytrivia.org'],
        hmr: {
            host: 'garminholidaytrivia.org',
            protocol: 'wss',
        },
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
            '/ws': {
                target: 'ws://localhost:3000',
                changeOrigin: true,
                ws: true,
            },
        },
        // Restrict file system access in dev mode
        fs: {
            strict: true,
            // Only allow access to client src, shared types, and node_modules
            allow: [
                path.resolve(__dirname, 'src'),
                path.resolve(__dirname, 'node_modules'),
                path.resolve(__dirname, '../shared'),
                path.resolve(__dirname, 'index.html'),
            ],
            // Explicitly deny access to sensitive directories
            deny: [
                path.resolve(__dirname, '../server'),
                path.resolve(__dirname, '../data'),
                path.resolve(__dirname, '../scripts'),
                path.resolve(__dirname, '../.env'),
                '**/.git/**',
                '**/node_modules/.vite/**',
            ],
        },
    },
    // Don't expose source maps in preview mode
    preview: {
        port: 8000,
        host: '0.0.0.0',
    },
}));
