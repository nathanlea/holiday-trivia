#!/usr/bin/env node
const { spawn } = require('child_process');

const isWindows = process.platform === 'win32';
let clientProcess = null;
let serverProcess = null;
let shuttingDown = false;

const sharedEnv = {
    ...process.env,
    CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? '1',
};

const serverEnv = {
    ...sharedEnv,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --no-deprecation`.trim(),
};

function terminateProcess(child) {
    if (!child || child.killed) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            if (!child.killed) {
                child.kill('SIGKILL');
            }
        }, 1500);

        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });

        child.kill('SIGTERM');
    });
}

async function shutdown(exitCode = 0) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    await Promise.all([
        terminateProcess(clientProcess),
        terminateProcess(serverProcess),
    ]);

    process.exit(exitCode);
}

function startClient() {
    if (clientProcess) {
        return;
    }

    clientProcess = spawn('npm', ['--workspace', 'client', 'run', 'dev'], {
        env: sharedEnv,
        shell: isWindows,
        stdio: 'inherit',
    });

    clientProcess.on('exit', (code) => {
        clientProcess = null;
        if (shuttingDown) {
            return;
        }
        console.log(`[client] exited with code ${code ?? 0}`);
        shutdown(code ?? 0);
    });
}

serverProcess = spawn('npm', ['--workspace', 'server', 'run', 'dev'], {
    env: serverEnv,
    shell: isWindows,
    stdio: ['inherit', 'pipe', 'pipe'],
});

serverProcess.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(`[server] ${text}`);
    if (!clientProcess && /Trivia server listening on http:\/\/localhost:\d+/.test(text)) {
        startClient();
    }
});

serverProcess.stderr.on('data', (data) => {
    process.stderr.write(`[server] ${data}`);
});

serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (!shuttingDown) {
        console.log(`[server] exited with code ${code ?? 0}`);
    }
    shutdown(code ?? 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => {
    console.error(error);
    shutdown(1);
});
