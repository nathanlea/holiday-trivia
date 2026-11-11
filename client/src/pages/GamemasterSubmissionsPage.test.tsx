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

    const updateState = (nextState: GamemasterGameState, connected = true) => {
        currentState = nextState;
        vi.mocked(useTriviaSocket).mockReturnValue({
            state: currentState, connected, error: null, submissionAck: null, wagerAck: null,
        });
        act(() => {
            renderer.update(<MemoryRouter><GamemasterSubmissionsPage /></MemoryRouter>);
        });
    };

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

    it('keeps the answer pane mounted through saving, success, failure, and dismissing feedback', async () => {
        const answers = renderer.root.findByProps({ className: 'submission-answers' });
        const feedback = renderer.root.findByProps({ className: 'grading-feedback' });
        let finishSave: () => void = () => { throw new Error('Save not started'); };
        vi.mocked(gradeSubmission).mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
        let saving: Promise<void>;
        act(() => { saving = button('Correct').props.onClick(); });
        expect(renderer.root.findByProps({ className: 'submission-answers' })).toBe(answers);
        await act(async () => { finishSave(); await saving; });
        expect(renderer.root.findByProps({ className: 'grading-feedback' })).toBe(feedback);
        expect(feedback.props['data-kind']).toBe('success');
        vi.mocked(gradeSubmission).mockRejectedValueOnce(new Error('Connection lost'));
        await act(async () => { await button('Incorrect').props.onClick(); });
        expect(feedback.props['data-kind']).toBe('error');
        expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Please retry.');
        act(() => renderer.root.findByProps({ 'aria-label': 'Dismiss grading message' }).props.onClick());
        expect(renderer.root.findByProps({ className: 'submission-answers' })).toBe(answers);
        expect(renderer.root.findByProps({ className: 'grading-feedback' })).toBe(feedback);
    });

    it('prioritizes pending teams, filters the queue, and keeps the selected answer open', () => {
        updateState({
            ...currentState,
            scoreboard: [...currentState.scoreboard, { teamId: 'pending', name: 'Pending team', score: 0 }],
            submissions: [...currentState.submissions, {
                ...currentState.submissions[0], id: 'pending-submission', teamId: 'pending', teamName: 'Pending team',
                answers: [{ ...currentState.submissions[0].answers[0], status: 'pending', awardedPoints: 0 }],
            }],
        });
        const queue = renderer.root.findByProps({ className: 'submission-grid' });
        expect(queue.findAllByType('button').map((entry) => entry.findByProps({ className: 'submission-tile-name' }).children.join('')))
            .toEqual(['Pending team', 'Team Tinsel', 'Still thinking']);
        const answers = renderer.root.findByProps({ className: 'submission-answers' });
        act(() => renderer.root.findByType('select').props.onChange({ target: { value: 'waiting' } }));
        expect(queue.findAllByType('button')).toHaveLength(1);
        expect(renderer.root.findByProps({ className: 'submission-answers' })).toBe(answers);
        act(() => button('Next team to review →').props.onClick());
        expect(renderer.root.findByType('select').props.value).toBe('all');
        expect(renderer.root.findByProps({ className: 'submission-detail-header' })
            .findByType('h4').children.join('')).toBe('Pending team');
        expect(queue.findAllByType('button').filter((entry) => entry.props['aria-pressed'])).toHaveLength(1);
        expect(button('Next team to review →').props.disabled).toBe(true);
    });

    it('wraps the review shortcut without moving teams automatically after a saved grade', () => {
        const submission = currentState.submissions[0];
        updateState({
            ...currentState,
            scoreboard: [0, 1, 2].map((index) => ({ teamId: `team-${index}`, name: `Team ${index}`, score: 0 })),
            submissions: [0, 1, 2].map((index) => ({
                ...submission, id: `submission-${index}`, teamId: `team-${index}`, teamName: `Team ${index}`,
                answers: [{ ...submission.answers[0], status: 'pending' }],
            })),
        });
        for (const index of [1, 2, 0]) {
            act(() => button('Next team to review →').props.onClick());
            expect(renderer.root.findByProps({ className: 'submission-detail-header' })
                .findByType('h4').children.join('')).toBe(`Team ${index}`);
        }
        const answers = renderer.root.findByProps({ className: 'submission-answers' });
        updateState({
            ...currentState,
            submissions: currentState.submissions.map((entry, index) => index ? entry : {
                ...entry, answers: [{ ...entry.answers[0], status: 'correct', awardedPoints: 20 }],
            }),
        });
        expect(renderer.root.findByProps({ className: 'submission-answers' })).toBe(answers);
        expect(renderer.root.findByProps({ className: 'submission-detail-header' })
            .findByType('h4').children.join('')).toBe('Team 0');
    });

    it('shows connection trouble in the reserved feedback area and pauses grading', () => {
        const answers = renderer.root.findByProps({ className: 'submission-answers' });
        updateState(currentState, false);
        expect(renderer.root.findByType('fieldset').props.disabled).toBe(true);
        expect(renderer.root.findByProps({ className: 'grading-feedback' }).props['data-kind']).toBe('error');
        expect(JSON.stringify(renderer.toJSON())).toContain('Grading is paused');
        updateState(currentState);
        expect(renderer.root.findByType('fieldset').props.disabled).toBe(false);
        expect(renderer.root.findByProps({ className: 'submission-answers' })).toBe(answers);
    });
});
