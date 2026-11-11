import type { GameSummary, SubmissionView } from '@shared/types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const PIN_HEADER = 'x-trivia-admin';

function getApiBase(): string {
    if (API_BASE) {
        return API_BASE.replace(/\/?$/, '');
    }
    if (typeof window !== 'undefined') {
        return `${window.location.origin}`;
    }
    return 'http://localhost:3000';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${getApiBase()}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(15_000),
        headers: {
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
        },
    });

    if (!response.ok) {
        const text = await response.text();
        let message = text || `Request failed with status ${response.status}`;
        if (response.headers.get('content-type')?.includes('application/json') && text) {
            const payload: unknown = JSON.parse(text);
            if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
                message = payload.error;
            }
        }
        throw new Error(message);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return (await response.json()) as T;
}

export interface CreateGameInput {
    title: string;
    adminSecret: string;
    code?: string;
}

export async function createGame(input: CreateGameInput) {
    return request<{ game: { id: string; code: string; title: string } }>(`/api/games`, {
        method: 'POST',
        headers: { [PIN_HEADER]: input.adminSecret },
        body: JSON.stringify({ title: input.title, code: input.code }),
    });
}

export async function fetchOpenGame() {
    return request<{ game: GameSummary | null }>('/api/games/open');
}

export async function setJoiningOpen(gameCode: string, adminSecret: string, open: boolean) {
    return request<void>(`/api/games/${gameCode}/joining`, {
        method: 'POST',
        headers: { [PIN_HEADER]: adminSecret },
        body: JSON.stringify({ open }),
    });
}

export async function importQuestionSet(gameCode: string, pin: string, payload: unknown) {
    return request<void>(`/api/games/${gameCode}/import`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
            'Content-Type': 'application/json',
            [PIN_HEADER]: pin,
        },
    });
}

export async function joinTeam(gameCode: string, name: string) {
    return request<{ teamId: string; teamToken: string; name: string; score: number; game: GameSummary }>(`/api/games/${gameCode}/teams`, {
        method: 'POST',
        body: JSON.stringify({ name }),
    });
}

export interface SubmitAnswersInput {
    gameCode: string;
    teamId: string;
    teamToken: string;
    roundId: string;
    answers: Array<{ questionId: string; response: string; pointValue: number | null }>;
}

export async function submitAnswers(payload: SubmitAnswersInput) {
    return request<{ status: string }>(`/api/games/${payload.gameCode}/answers`, {
        method: 'POST',
        body: JSON.stringify({
            teamId: payload.teamId,
            teamToken: payload.teamToken,
            roundId: payload.roundId,
            answers: payload.answers,
        }),
    });
}

export async function submitWager(gameCode: string, teamId: string, teamToken: string, roundId: string, amount: number) {
    return request<void>(`/api/games/${gameCode}/wagers`, {
        method: 'POST',
        body: JSON.stringify({ teamId, teamToken, roundId, amount }),
    });
}

export async function openRound(gameCode: string, pin: string, roundId: string) {
    return request<void>(`/api/games/${gameCode}/rounds/${roundId}/open`, {
        method: 'POST',
        headers: { [PIN_HEADER]: pin },
    });
}

export async function closeRound(gameCode: string, pin: string, roundId: string) {
    return request<void>(`/api/games/${gameCode}/rounds/${roundId}/close`, {
        method: 'POST',
        headers: { [PIN_HEADER]: pin },
    });
}

export async function gradeSubmission(
    gameCode: string,
    pin: string,
    submissionId: string,
    grades: Array<{ questionId: string; status: SubmissionView['answers'][number]['status']; awardedPoints?: number }>,
) {
    return request<void>(`/api/games/${gameCode}/submissions/${submissionId}/grade`, {
        method: 'POST',
        headers: {
            [PIN_HEADER]: pin,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ grades }),
    });
}

export async function fetchScoreboard(gameCode: string) {
    return request<{ scoreboard: Array<{ teamId: string; name: string; score: number }> }>(`/api/games/${gameCode}/scoreboard`);
}

export async function removeTeam(gameCode: string, pin: string, teamId: string) {
    return request<void>(`/api/games/${gameCode}/teams/${teamId}`, {
        method: 'DELETE',
        headers: { [PIN_HEADER]: pin },
    });
}

export async function adjustTeamScore(gameCode: string, pin: string, teamId: string, delta: number, note?: string) {
    return request<{ score: number; delta: number; updatedAt: string }>(`/api/games/${gameCode}/teams/${teamId}/adjust-score`, {
        method: 'POST',
        headers: {
            [PIN_HEADER]: pin,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ delta, note }),
    });
}

export function getWebsocketUrl(): string {
    if (import.meta.env.VITE_WS_BASE) {
        return `${import.meta.env.VITE_WS_BASE}`;
    }
    if (typeof window !== 'undefined') {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}`;
    }
    return 'ws://localhost:3000';
}
