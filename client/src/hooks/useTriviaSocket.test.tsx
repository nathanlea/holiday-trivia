import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTriviaSocket, type TriviaSocketOptions } from './useTriviaSocket';

class TestSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: TestSocket[] = [];
    readyState = TestSocket.CONNECTING;
    send = vi.fn();

    constructor(public url: string) {
        super();
        TestSocket.instances.push(this);
    }

    open() {
        this.readyState = TestSocket.OPEN;
        this.dispatchEvent(new Event('open'));
    }

    receive(message: unknown) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    }

    close(code = 1006, reason = '') {
        this.readyState = TestSocket.CLOSED;
        this.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
    }
}

const options: TriviaSocketOptions = { role: 'scoreboard', gameCode: 'LUNCH' };
const state = {
    role: 'scoreboard',
    game: { id: 'game', code: 'LUNCH', title: 'Lunch', currentRoundId: null, createdAt: '', joiningOpen: true },
    rounds: [], scoreboard: [], lastUpdated: '', currentRoundStatus: 'pending',
};

function Harness({ options }: { options: TriviaSocketOptions }) {
    const socket = useTriviaSocket(options);
    return <output>{socket.connected ? 'connected' : 'disconnected'}</output>;
}

describe('WebSocket lifecycle', () => {
    let renderer: ReactTestRenderer | undefined;
    let browser: EventTarget;
    let documentState: EventTarget & { visibilityState: string };

    beforeEach(() => {
        vi.useFakeTimers();
        TestSocket.instances = [];
        browser = Object.assign(new EventTarget(), {
            location: { origin: 'http://localhost:8000', protocol: 'http:', host: 'localhost:8000' },
            setTimeout, clearTimeout,
        });
        documentState = Object.assign(new EventTarget(), { visibilityState: 'visible' });
        vi.stubGlobal('window', browser);
        vi.stubGlobal('document', documentState);
        vi.stubGlobal('WebSocket', TestSocket);
        act(() => { renderer = create(<Harness options={options} />); });
    });

    afterEach(() => {
        act(() => renderer?.unmount());
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('authenticates before marking the connection live', () => {
        const socket = TestSocket.instances[0];
        expect(socket.url).toBe('ws://localhost:8000/ws');
        act(() => socket.open());
        expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
            type: 'hello', payload: { role: 'scoreboard', gameCode: 'LUNCH' },
        });
        expect(renderer?.root.findByType('output').children).toEqual(['disconnected']);
        act(() => socket.receive({ type: 'game_state', payload: state }));
        expect(renderer?.root.findByType('output').children).toEqual(['connected']);
    });

    it('reconnects after a server restart and increases backoff until state arrives', () => {
        act(() => TestSocket.instances[0].close(1012, 'Server restarting'));
        act(() => { vi.advanceTimersByTime(999); });
        expect(TestSocket.instances).toHaveLength(1);
        act(() => { vi.advanceTimersByTime(1); });
        expect(TestSocket.instances).toHaveLength(2);
        act(() => TestSocket.instances[1].close());
        act(() => { vi.advanceTimersByTime(1999); });
        expect(TestSocket.instances).toHaveLength(2);
        act(() => { vi.advanceTimersByTime(1); });
        expect(TestSocket.instances).toHaveLength(3);
        act(() => {
            TestSocket.instances[2].open();
            TestSocket.instances[2].receive({ type: 'game_state', payload: state });
            TestSocket.instances[2].close();
        });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(TestSocket.instances).toHaveLength(4);
    });

    it('schedules one retry after an error followed by close', () => {
        act(() => { TestSocket.instances[0].dispatchEvent(new Event('error')); });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(TestSocket.instances).toHaveLength(1);
        act(() => TestSocket.instances[0].close());
        act(() => { vi.advanceTimersByTime(1000); });
        expect(TestSocket.instances).toHaveLength(2);
    });

    it('does not retry rejected credentials', () => {
        act(() => {
            TestSocket.instances[0].receive({ type: 'error', message: 'Invalid host secret' });
            TestSocket.instances[0].close(1008, 'Unauthorized');
            vi.advanceTimersByTime(60_000);
        });
        expect(TestSocket.instances).toHaveLength(1);
    });

    it('retries immediately when a disconnected tab becomes visible', () => {
        act(() => {
            TestSocket.instances[0].close();
            documentState.visibilityState = 'hidden';
            documentState.dispatchEvent(new Event('visibilitychange'));
        });
        expect(TestSocket.instances).toHaveLength(1);
        act(() => {
            documentState.visibilityState = 'visible';
            documentState.dispatchEvent(new Event('visibilitychange'));
        });
        expect(TestSocket.instances).toHaveLength(2);
        act(() => { vi.advanceTimersByTime(1000); });
        expect(TestSocket.instances).toHaveLength(2);
    });

    it('retries on restored network connectivity and cancels retries on sign-out', () => {
        act(() => TestSocket.instances[0].close(1000));
        act(() => { browser.dispatchEvent(new Event('online')); });
        expect(TestSocket.instances).toHaveLength(2);
        act(() => renderer?.update(<Harness options={null} />));
        act(() => { vi.advanceTimersByTime(60_000); });
        expect(TestSocket.instances).toHaveLength(2);
        expect(renderer?.root.findByType('output').children).toEqual(['disconnected']);
    });
});
