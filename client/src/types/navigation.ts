export type ConnectionStatus = 'online' | 'offline' | 'error' | null;

export interface TeamHeaderState {
    role: 'team';
    teamName: string;
    gameTitle: string | null;
    onLeave: () => void;
}

export interface GamemasterHeaderState {
    role: 'gamemaster';
    gameCode: string;
    gameTitle: string | null;
    onSignOut: () => void;
}

export type HeaderSessionState = TeamHeaderState | GamemasterHeaderState;
