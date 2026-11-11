import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, 'src'),
            '@shared': path.resolve(import.meta.dirname, '../shared'),
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        rolldownOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('/node_modules/')) return 'vendor';
                },
            },
        },
    },
    server: {
        port: 8000,
        host: '0.0.0.0',
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
                path.resolve(import.meta.dirname, 'src'),
                path.resolve(import.meta.dirname, 'node_modules'),
                path.resolve(import.meta.dirname, '../shared'),
                path.resolve(import.meta.dirname, 'index.html'),
            ],
            // Explicitly deny access to sensitive directories
            deny: [
                path.resolve(import.meta.dirname, '../server'),
                path.resolve(import.meta.dirname, '../data'),
                path.resolve(import.meta.dirname, '../scripts'),
                path.resolve(import.meta.dirname, '../.env'),
                '**/.git/**',
            ],
        },
    },
    // Don't expose source maps in preview mode
    preview: {
        port: 8000,
        host: '0.0.0.0',
    },
});
