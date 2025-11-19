export type ClientRole = 'team' | 'gamemaster' | 'scoreboard';

export type RoundStatus = 'pending' | 'open' | 'closed';

export interface TeamScore {
    teamId: string;
    name: string;
    score: number;
}

export interface GameSummary {
    id: string;
    code: string;
    title: string;
    currentRoundId: string | null;
    createdAt: string;
}

export interface NumericScoringConfig {
    correctAnswer: number;
    ranges: Array<{
        maxPercentOff: number;
        pointsPercent: number;
    }>;
}

export interface RoundQuestionView {
    id: string;
    order: number;
    type: 'mcq' | 'open' | 'numeric';
    text: string;
    choices?: string[];
    explanation?: string | null;
    correctChoiceIndices?: number[] | null;
    correctAnswerText?: string | null;
    numericConfig?: NumericScoringConfig | null;
}

export type RoundMode = 'standard' | 'final' | 'wager';

export interface RoundStateView {
    id: string;
    index: number;
    label: string;
    status: RoundStatus;
    pointOptions: number[];
    timeLimitSeconds: number | null;
    isFinal: boolean;
    openedAt: string | null;
    closedAt: string | null;
    questions: RoundQuestionView[];
    mode: RoundMode;
    linkedRoundId?: string | null;
    linkedRoundLabel?: string | null;
}

export interface TeamSubmissionSummary {
    roundId: string;
    status: 'not_submitted' | 'submitted' | 'graded';
    submittedAt?: string;
}

export interface TeamWagerSummary {
    teamId: string;
    roundId: string;
    amount: number;
    lockedAt: string;
}

export interface SubmissionAnswerView {
    questionId: string;
    response: string;
    pointValue: number | null;
    status: 'pending' | 'correct' | 'incorrect';
    awardedPoints: number;
}

export interface SubmissionView {
    id: string;
    teamId: string;
    teamName: string;
    roundId: string;
    createdAt: string;
    answers: SubmissionAnswerView[];
    wagerAmount?: number | null;
}

export interface BaseGameState {
    game: GameSummary;
    rounds: RoundStateView[];
    scoreboard: TeamScore[];
    lastUpdated: string;
}

export interface TeamGameState extends BaseGameState {
    role: 'team';
    team?: {
        id: string;
        name: string;
        score: number;
        submissions: TeamSubmissionSummary[];
        wagers: TeamWagerSummary[];
    };
    currentRound?: RoundStateView;
    timeRemainingSeconds?: number | null;
    waitingMessage?: string;
}

export interface GamemasterGameState extends BaseGameState {
    role: 'gamemaster';
    submissions: SubmissionView[];
    wagers: TeamWagerSummary[];
}

export interface ScoreboardGameState extends BaseGameState {
    role: 'scoreboard';
    currentRoundStatus: RoundStatus;
    waitingMessage?: string;
}

export type ServerGameState = TeamGameState | GamemasterGameState | ScoreboardGameState;

export interface HelloPayload {
    role: ClientRole;
    gameCode: string;
    teamId?: string;
    teamToken?: string;
    pin?: string;
}

export interface ClientHelloMessage {
    type: 'hello';
    payload: HelloPayload;
}

export interface ClientPingMessage {
    type: 'ping';
}

export type ClientToServerMessage = ClientHelloMessage | ClientPingMessage;

export interface HelloAckMessage {
    type: 'hello_ack';
    role: ClientRole;
}

export interface GameStateMessage {
    type: 'game_state';
    payload: ServerGameState;
}

export interface SubmissionAckMessage {
    type: 'submission_ack';
    payload: {
        roundId: string;
        status: 'accepted' | 'late' | 'rejected';
        message?: string;
    };
}

export interface WagerAckMessage {
    type: 'wager_ack';
    payload: {
        roundId: string;
        status: 'accepted' | 'rejected';
        message?: string;
    };
}

export interface ErrorMessage {
    type: 'error';
    message: string;
}

export interface PongMessage {
    type: 'pong';
}

export type ServerToClientMessage =
    | HelloAckMessage
    | GameStateMessage
    | SubmissionAckMessage
    | WagerAckMessage
    | ErrorMessage
    | PongMessage;
