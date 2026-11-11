import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamGameState } from '@shared/types';
import { submitAnswers, submitWager } from '../api';
import { useTriviaSocket } from '../hooks/useTriviaSocket';
import TeamPage from './TeamPage';

vi.mock('../api', () => ({
    fetchOpenGame: vi.fn(), joinTeam: vi.fn(), submitAnswers: vi.fn(), submitWager: vi.fn(),
}));
vi.mock('../hooks/useTriviaSocket', () => ({ useTriviaSocket: vi.fn() }));

describe('Optional answers and advisory team timer', () => {
    let renderer: ReactTestRenderer | undefined;
    let state: TeamGameState;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-12-01T12:00:00Z'));
        const storage = () => {
            const values = new Map<string, string>();
            return {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => { values.set(key, value); },
                removeItem: (key: string) => { values.delete(key); },
            };
        };
        const localStorage = storage();
        localStorage.setItem('trivia.team.session.v2', JSON.stringify({
            gameCode: 'LUNCH', teamId: 'team', teamToken: 'token', teamName: 'Tinsel',
        }));
        vi.stubGlobal('window', {
            localStorage, sessionStorage: storage(), setTimeout, clearTimeout, setInterval, clearInterval,
        });
        vi.stubGlobal('document', new EventTarget());
        const round = {
            id: 'round', index: 0, label: 'Round 1', status: 'open' as const, pointOptions: [10],
            timeLimitSeconds: 60, isFinal: false, mode: 'standard' as const,
            openedAt: '2026-12-01T11:58:00Z', closedAt: null,
            questions: [{ id: 'question', order: 0, type: 'open' as const, text: 'Name a reindeer' }],
        };
        state = {
            role: 'team', lastUpdated: '', scoreboard: [], rounds: [round], currentRound: round,
            game: { id: 'game', code: 'LUNCH', title: 'Lunch', currentRoundId: 'round', createdAt: '', joiningOpen: true },
            timeRemainingSeconds: 0,
            team: { id: 'team', name: 'Tinsel', score: 10, submissions: [], wagers: [] },
        };
        vi.mocked(submitAnswers).mockResolvedValue({ status: 'received' });
        vi.mocked(submitWager).mockResolvedValue(undefined);
    });

    afterEach(() => {
        act(() => renderer?.unmount());
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function render() {
        vi.mocked(useTriviaSocket).mockReturnValue({
            state, connected: true, error: null, submissionAck: null, wagerAck: null,
        });
        act(() => { renderer = create(<TeamPage />); });
    }

    it('can submit a blank text answer after the timer expires and keeps the timer visible', async () => {
        render();
        expect(renderer!.root.findByType('textarea').props.required).not.toBe(true);
        expect(renderer!.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
        expect(renderer!.root.findByProps({ role: 'timer' }).children.join('')).toBe('0:00');
        expect(renderer!.root.findByType('aside').props['aria-label']).toBe('Round timer');
        expect(JSON.stringify(renderer!.toJSON())).toContain('Time is up - still open');
        await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
        expect(submitAnswers).toHaveBeenCalledWith({
            gameCode: 'LUNCH', teamId: 'team', teamToken: 'token', roundId: 'round',
            answers: [{ questionId: 'question', response: '', pointValue: 10 }],
        });
    });

    it('does not require a numeric final answer', async () => {
        state.currentRound!.isFinal = true;
        state.currentRound!.mode = 'final';
        state.currentRound!.questions[0].type = 'numeric';
        state.team!.wagers = [{ teamId: 'team', roundId: 'round', amount: 5, lockedAt: '' }];
        render();
        expect(renderer!.root.findByProps({ inputMode: 'decimal' }).props.required).not.toBe(true);
        await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
        expect(submitAnswers).toHaveBeenCalledWith(expect.objectContaining({
            answers: [{ questionId: 'question', response: '', pointValue: null }],
        }));
    });

    it('keeps submission enabled when a running timer reaches zero', () => {
        state.currentRound!.openedAt = new Date().toISOString();
        state.currentRound!.timeLimitSeconds = 2;
        state.timeRemainingSeconds = 2;
        render();
        expect(renderer!.root.findByProps({ role: 'timer' }).children.join('')).toBe('0:02');
        act(() => { vi.advanceTimersByTime(2000); });
        expect(renderer!.root.findByProps({ role: 'timer' }).children.join('')).toBe('0:00');
        expect(renderer!.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
    });

    it('can submit a wager after its timer expires', async () => {
        state.currentRound!.mode = 'wager';
        state.currentRound!.questions = [];
        state.currentRound!.linkedRoundId = 'final';
        render();
        expect(renderer!.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
        act(() => { renderer!.root.findByProps({ type: 'number' }).props.onChange({ target: { value: '5' } }); });
        await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
        expect(submitWager).toHaveBeenCalledWith('LUNCH', 'team', 'token', 'round', 5);
    });

    it('does not show an answer form or floating timer once the host closes the round', () => {
        state.currentRound!.status = 'closed';
        render();
        expect(renderer!.root.findAllByProps({ type: 'submit' })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ role: 'timer' })).toHaveLength(0);
    });
});
