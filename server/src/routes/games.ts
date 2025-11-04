import express, { Request, Response } from 'express';
import { PIN_HEADER } from '../config';
import { HttpError } from '../errors';
import GameManager from '../gameManager';

const router = express.Router();

function getPinOrThrow(req: Request): string {
    const pin = req.header(PIN_HEADER) ?? (req.body?.pin as string | undefined);
    if (!pin) {
        throw new HttpError(401, 'PIN is required for this operation');
    }
    return pin;
}

function handleError(res: Response, error: unknown): Response {
    if (error instanceof HttpError) {
        return res.status(error.status).json({ error: error.message });
    }
    console.error('[server]', error);
    return res.status(500).json({ error: 'Unexpected server error' });
}

export function createApiRouter(manager: GameManager): express.Router {
    router.post('/games', async (req: Request, res: Response) => {
        try {
            const { title, pin, code } = req.body ?? {};
            if (typeof title !== 'string' || typeof pin !== 'string') {
                throw new HttpError(400, 'Title and PIN are required');
            }
            const game = await manager.createGame(title, pin, typeof code === 'string' ? code : undefined);
            res.status(201).json({ game });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.get('/games/:code', async (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const scoreboard = await manager.getScoreboard(code);
            res.json({ code, scoreboard });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/games/:code/import', async (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const pin = getPinOrThrow(req);
            await manager.importGameData(code, pin, req.body);
            res.status(204).send();
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/games/:code/teams', async (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const { name } = req.body ?? {};
            if (typeof name !== 'string') {
                throw new HttpError(400, 'Team name is required');
            }
            const result = await manager.joinTeam(code, name);
            res.status(201).json(result);
        } catch (error) {
            handleError(res, error);
        }
    });

    router.delete('/games/:code/teams/:teamId', async (req: Request, res: Response) => {
        try {
            const { code, teamId } = req.params;
            const pin = getPinOrThrow(req);
            await manager.removeTeam(code, pin, teamId);
            res.status(204).send();
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/games/:code/teams/:teamId/adjust-score', async (req: Request, res: Response) => {
        try {
            const { code, teamId } = req.params;
            const pin = getPinOrThrow(req);
            const { delta, note } = req.body ?? {};
            const parsedDelta = Number(delta);
            if (!Number.isFinite(parsedDelta)) {
                throw new HttpError(400, 'Adjustment amount must be a number');
            }
            const result = await manager.adjustTeamScore(code, pin, teamId, parsedDelta, typeof note === 'string' ? note : undefined);
            res.status(200).json({ score: result.score, delta: result.delta, updatedAt: result.updatedAt });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/games/:code/wagers', async (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const { teamId, teamToken, roundId, amount } = req.body ?? {};
            if (typeof teamId !== 'string' || typeof teamToken !== 'string' || typeof roundId !== 'string') {
                throw new HttpError(400, 'teamId, teamToken, and roundId are required');
            }
            const wagerAmount = Number(amount);
            if (!Number.isFinite(wagerAmount)) {
                throw new HttpError(400, 'Amount must be a number');
            }
            await manager.submitWager(code, teamId, teamToken, roundId, Math.floor(wagerAmount));
            res.status(204).send();
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/games/:code/answers', async (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const { teamId, teamToken, roundId, answers } = req.body ?? {};
            if (typeof teamId !== 'string' || typeof teamToken !== 'string' || typeof roundId !== 'string') {
                throw new HttpError(400, 'teamId, teamToken, and roundId are required');
            }
            if (!Array.isArray(answers)) {
                throw new HttpError(400, 'answers must be an array');
            }
            await manager.submitAnswers(code, teamId, teamToken, roundId, answers);
            res.status(202).json({ status: 'received' });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/games/:code/rounds/:roundId/open', async (req: Request, res: Response) => {
        try {
            const { code, roundId } = req.params;
            const pin = getPinOrThrow(req);
            await manager.openRound(code, pin, roundId);
            res.status(204).send();
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/games/:code/rounds/:roundId/close', async (req: Request, res: Response) => {
        try {
            const { code, roundId } = req.params;
            const pin = getPinOrThrow(req);
            await manager.closeRound(code, pin, roundId);
            res.status(204).send();
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/games/:code/submissions/:submissionId/grade', async (req: Request, res: Response) => {
        try {
            const { code, submissionId } = req.params;
            const pin = getPinOrThrow(req);
            const body = req.body ?? {};
            const gradeList = Array.isArray(body) ? body : body.grades;
            if (!Array.isArray(gradeList)) {
                throw new HttpError(400, 'grades must be an array');
            }
            await manager.gradeSubmission(code, pin, submissionId, gradeList);
            res.status(204).send();
        } catch (error) {
            handleError(res, error);
        }
    });

    router.get('/games/:code/scoreboard', async (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const scoreboard = await manager.getScoreboard(code);
            res.json({ scoreboard });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok', time: new Date().toISOString() });
    });

    return router;
}
