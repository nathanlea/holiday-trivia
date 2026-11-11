import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamemasterGameState } from '@shared/types';
import { gradeSubmission } from '../api';
import { useTriviaSocket } from '../hooks/useTriviaSocket';
import GamemasterSubmissionsPage from './GamemasterSubmissionsPage';

vi.mock('../api', () => ({ gradeSubmission: vi.fn() }));
vi.mock('../hooks/useTriviaSocket', () => ({ useTriviaSocket: vi.fn() }));
vi.mock('../hostSession', () => ({
    loadHostSession: () => ({ gameCode: 'LUNCH', adminSecret: 'test-secret' }),
}));

function state(): GamemasterGameState {
    return {
        role: 'gamemaster', lastUpdated: '', wagers: [],
        game: { id: 'game', code: 'LUNCH', title: 'Lunch', currentRoundId: 'round', createdAt: '', joiningOpen: true },
        scoreboard: [
            { teamId: 'team', name: 'Team Tinsel', score: 10 },
            { teamId: 'waiting-team', name: 'Still thinking', score: 5 },
        ],
        rounds: [{
            id: 'round', index: 0, label: 'Final', status: 'open', pointOptions: [0],
            timeLimitSeconds: 60, isFinal: true, openedAt: null, closedAt: null, mode: 'final',
            questions: [{
                id: 'question', order: 0, type: 'numeric', text: 'Estimate 100', numericConfig: {
                    correctAnswer: 100, ranges: [{ maxPercentOff: 10, pointsPercent: 50 }],
                },
            }],
        }],
        submissions: [{
            id: 'submission', teamId: 'team', teamName: 'Team Tinsel', roundId: 'round', createdAt: '', wagerAmount: 20,
            answers: [{ questionId: 'question', response: '110', pointValue: null, status: 'correct', awardedPoints: 10 }],
        }],
    };
}

describe('Immediate host grading', () => {
    let renderer: ReactTestRenderer;
    let currentState: GamemasterGameState;

    beforeEach(() => {
        vi.clearAllMocks();
        currentState = state();
        vi.mocked(useTriviaSocket).mockReturnValue({
            state: currentState, connected: true, error: null, submissionAck: null, wagerAck: null,
        });
        vi.mocked(gradeSubmission).mockResolvedValue(undefined);
        act(() => {
            renderer = create(<MemoryRouter initialEntries={['/gamemaster/submissions?game=LUNCH']}>
                <GamemasterSubmissionsPage />
            </MemoryRouter>);
        });
    });

    afterEach(() => {
        act(() => renderer.unmount());
        vi.unstubAllGlobals();
    });

    const button = (label: string) => renderer.root.findAllByType('button')
        .find((entry) => entry.children.join('') === label)!;

    it('opens an automatic grade for review before selecting a team still waiting to submit', () => {
        expect(renderer.root.findByProps({ className: 'submission-detail-header' })
            .findByType('h4').children.join('')).toBe('Team Tinsel');
    });

    it('saves each action without Save Grades and can override an existing automatic grade', async () => {
        for (const [label, status, awardedPoints] of [
            ['Correct', 'correct', 20], ['Incorrect', 'incorrect', -20], ['Reset', 'pending', 0],
            ['50% (10 pts)', 'correct', 10],
        ] as const) {
            await act(async () => { await button(label).props.onClick(); });
            expect(gradeSubmission).toHaveBeenLastCalledWith('LUNCH', 'test-secret', 'submission', [{
                questionId: 'question', status, awardedPoints,
            }]);
        }
        expect(renderer.root.findAllByType('button').some((entry) => entry.children.join('') === 'Save Grades')).toBe(false);
        expect(JSON.stringify(renderer.toJSON())).toContain('Total updated.');
    });

    it('does not re-save grades on a server update', () => {
        const updatedState: GamemasterGameState = {
            ...currentState,
            lastUpdated: new Date().toISOString(),
            scoreboard: [{ teamId: 'team', name: 'Team Tinsel', score: 20 }],
            submissions: currentState.submissions.map((submission) => ({
                ...submission,
                answers: submission.answers.map((answer) => ({ ...answer, awardedPoints: 20 })),
            })),
        };
        vi.mocked(useTriviaSocket).mockReturnValue({
            state: updatedState, connected: true, error: null, submissionAck: null, wagerAck: null,
        });
        act(() => {
            renderer.update(<MemoryRouter><GamemasterSubmissionsPage /></MemoryRouter>);
        });
        expect(gradeSubmission).not.toHaveBeenCalled();
        expect(renderer.root.findByProps({ className: 'submission-detail-meta' })
            .findAllByType('span')[0].children.join('')).toBe('Score: 20');
    });

    it('blocks overlapping grade requests and reports a failure with a retry', async () => {
        let rejectSave: (reason: Error) => void = () => { throw new Error('Save not started'); };
        vi.mocked(gradeSubmission).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
        let saving: Promise<void>;
        act(() => { saving = button('Correct').props.onClick(); });
        expect(renderer.root.findByType('fieldset').props.disabled).toBe(true);
        await act(async () => {
            await button('Incorrect').props.onClick();
            rejectSave(new Error('Connection lost'));
            await saving;
        });
        expect(gradeSubmission).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(renderer.toJSON())).toContain('Grade not saved. Connection lost Please retry.');
        expect(renderer.root.findByType('fieldset').props.disabled).toBe(false);
        await act(async () => { await button('Correct').props.onClick(); });
        expect(gradeSubmission).toHaveBeenCalledTimes(2);
    });

    it('saves negative custom final points immediately', async () => {
        vi.stubGlobal('prompt', vi.fn(() => '-5'));
        await act(async () => { button('Custom').props.onClick(); });
        expect(gradeSubmission).toHaveBeenCalledWith('LUNCH', 'test-secret', 'submission', [{
            questionId: 'question', status: 'incorrect', awardedPoints: -5,
        }]);
    });

    it('uses the final wager rather than any point value supplied with an answer', async () => {
        currentState.submissions[0].answers[0].pointValue = 0;
        act(() => { renderer.update(<MemoryRouter><GamemasterSubmissionsPage /></MemoryRouter>); });
        await act(async () => { await button('Correct').props.onClick(); });
        expect(gradeSubmission).toHaveBeenCalledWith('LUNCH', 'test-secret', 'submission', [{
            questionId: 'question', status: 'correct', awardedPoints: 20,
        }]);
    });
});
