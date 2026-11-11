import { useEffect, useMemo, useRef, useState } from 'react';
import type {
    ClientRole,
    ServerGameState,
    SubmissionAckMessage,
    WagerAckMessage,
} from '@shared/types';
import { getWebsocketUrl } from '../api';

export type TeamSocketOptions = {
    role: 'team';
    gameCode: string;
    teamId: string;
    teamToken: string;
};

export type GamemasterSocketOptions = {
    role: 'gamemaster';
    gameCode: string;
    adminSecret: string;
};

export type ScoreboardSocketOptions = {
    role: 'scoreboard';
    gameCode: string;
};

export type TriviaSocketOptions = TeamSocketOptions | GamemasterSocketOptions | ScoreboardSocketOptions | null;

export interface TriviaSocketState {
    state: ServerGameState | null;
    submissionAck: SubmissionAckMessage['payload'] | null;
    wagerAck: WagerAckMessage['payload'] | null;
    error: string | null;
    connected: boolean;
}

export function useTriviaSocket(options: TriviaSocketOptions): TriviaSocketState {
    const [state, setState] = useState<ServerGameState | null>(null);
    const [submissionAck, setSubmissionAck] = useState<SubmissionAckMessage['payload'] | null>(null);
    const [wagerAck, setWagerAck] = useState<WagerAckMessage['payload'] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);

    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const activeConnectionIdRef = useRef<number | null>(null);
    const connectionCounterRef = useRef(0);
    const retryAttemptsRef = useRef(0);
    const optionsRef = useRef<TriviaSocketOptions>(options);
    const [retryToken, setRetryToken] = useState(0);

    const connectionSignature = useMemo(() => {
        if (!options) {
            return null;
        }
        if (options.role === 'team') {
            return `${options.role}:${options.gameCode}:${options.teamId}:${options.teamToken}`;
        }
        return options.role === 'gamemaster'
            ? `${options.role}:${options.gameCode}:${options.adminSecret}`
            : `${options.role}:${options.gameCode}`;
    }, [options]);

    useEffect(() => {
        optionsRef.current = options;
    }, [options]);

    useEffect(() => {
        return () => {
            if (reconnectTimerRef.current != null) {
                window.clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const currentOptions = optionsRef.current;

        if (reconnectTimerRef.current != null) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }

        if (!connectionSignature || !currentOptions) {
            if (socketRef.current) {
                socketRef.current.close(1000, 'client navigation');
                socketRef.current = null;
            }
            activeConnectionIdRef.current = null;
            setState(null);
            setSubmissionAck(null);
            setWagerAck(null);
            setConnected(false);
            setError(null);
            return;
        }

        const wsBase = getWebsocketUrl().replace(/\/$/, '');
        const socket = new WebSocket(`${wsBase}/ws`);
        socketRef.current = socket;
        const connectionId = connectionCounterRef.current + 1;
        connectionCounterRef.current = connectionId;
        activeConnectionIdRef.current = connectionId;

        let shouldRetry = true;
        let intentionalClose = false;

        setError(null);

        const isCurrentConnection = () => activeConnectionIdRef.current === connectionId;

        const sendHello = () => {
            const payload = {
                role: currentOptions.role as ClientRole,
                gameCode: currentOptions.gameCode,
                teamId: 'teamId' in currentOptions ? currentOptions.teamId : undefined,
                teamToken: 'teamToken' in currentOptions ? currentOptions.teamToken : undefined,
                adminSecret: 'adminSecret' in currentOptions ? currentOptions.adminSecret : undefined,
            };

            socket.send(
                JSON.stringify({
                    type: 'hello',
                    payload,
                }),
            );
        };

        const handleOpen = () => {
            if (!isCurrentConnection()) {
                return;
            }
            sendHello();
        };

        const handleMessage = (event: MessageEvent) => {
            if (!isCurrentConnection()) {
                return;
            }
            try {
                const message = JSON.parse(event.data);
                switch (message.type) {
                    case 'game_state':
                        retryAttemptsRef.current = 0;
                        setConnected(true);
                        setError(null);
                        setState(message.payload as ServerGameState);
                        break;
                    case 'submission_ack':
                        setSubmissionAck(message.payload as SubmissionAckMessage['payload']);
                        break;
                    case 'wager_ack':
                        setWagerAck(message.payload as WagerAckMessage['payload']);
                        break;
                    case 'error':
                        shouldRetry = false;
                        setError(typeof message.message === 'string' ? message.message : 'WebSocket error');
                        break;
                    default:
                        break;
                }
            } catch (err) {
                shouldRetry = false;
                setError((err as Error).message);
            }
        };

        const scheduleReconnect = () => {
            if (!isCurrentConnection() || !shouldRetry) {
                return;
            }
            const delay = Math.min(1000 * 2 ** retryAttemptsRef.current, 8000);
            retryAttemptsRef.current += 1;
            reconnectTimerRef.current = window.setTimeout(() => {
                if (activeConnectionIdRef.current === connectionId) {
                    setRetryToken((token) => token + 1);
                }
            }, delay);
        };

        const handleClose = (event: CloseEvent) => {
            if (!isCurrentConnection()) {
                return;
            }
            setConnected(false);
            socketRef.current = null;
            if (reconnectTimerRef.current != null) {
                window.clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (intentionalClose) {
                return;
            }
            if (event.code !== 1000 && event.reason && shouldRetry) {
                setError(event.reason);
            }
            if (shouldRetry) {
                scheduleReconnect();
            }
        };

        const handleError = () => {
            if (!isCurrentConnection()) {
                return;
            }
            setError('WebSocket connection error');
        };

        const reconnectOnResume = () => {
            if (document.visibilityState !== 'visible' || !isCurrentConnection() || !shouldRetry ||
                socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                return;
            }
            if (reconnectTimerRef.current != null) {
                window.clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            retryAttemptsRef.current = 0;
            setRetryToken((token) => token + 1);
        };

        document.addEventListener('visibilitychange', reconnectOnResume);
        window.addEventListener('online', reconnectOnResume);
        socket.addEventListener('open', handleOpen);
        socket.addEventListener('message', handleMessage);
        socket.addEventListener('close', handleClose);
        socket.addEventListener('error', handleError);

        return () => {
            intentionalClose = true;
            document.removeEventListener('visibilitychange', reconnectOnResume);
            window.removeEventListener('online', reconnectOnResume);
            socket.removeEventListener('open', handleOpen);
            socket.removeEventListener('message', handleMessage);
            socket.removeEventListener('close', handleClose);
            socket.removeEventListener('error', handleError);
            if (activeConnectionIdRef.current === connectionId) {
                activeConnectionIdRef.current = null;
            }
            if (reconnectTimerRef.current != null) {
                window.clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            socket.close(1000, 'client cleanup');
            if (socketRef.current === socket) {
                socketRef.current = null;
            }
        };
    }, [connectionSignature, retryToken]);

    return {
        state,
        submissionAck,
        wagerAck,
        error,
        connected,
    };
}
