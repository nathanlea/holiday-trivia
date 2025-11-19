module.exports = {
    apps: [
        {
            name: 'server',
            script: 'npm',
            args: '--workspace server run dev',
            cwd: '/home/trivia',
            env: {
                NODE_ENV: 'development',
                CHOKIDAR_USEPOLLING: '1',
            },
            wait_ready: true,
            listen_timeout: 5000,
            kill_timeout: 5000,
        },
        {
            name: 'client',
            script: 'npm',
            args: '--workspace client run dev',
            cwd: '/home/trivia',
            env: {
                NODE_ENV: 'development',
                CHOKIDAR_USEPOLLING: '1',
            },
            wait_ready: true,
            listen_timeout: 5000,
            kill_timeout: 5000,
        },
    ],
};
