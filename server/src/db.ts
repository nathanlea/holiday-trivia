import fs from 'fs';
import { Sequelize } from 'sequelize';
import { DATA_DIR, DB_STORAGE } from './config';
import { Game, initGameModel } from './model/game';
import { Question, initQuestionModel } from './model/question';
import { Round, initRoundModel } from './model/round';
import { Submission, initSubmissionModel } from './model/submission';
import { SubmissionResult, initSubmissionResultModel } from './model/submissionResult';
import { Team, initTeamModel } from './model/team';
import { Wager, initWagerModel } from './model/wager';

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: DB_STORAGE,
    logging: false,
});

initGameModel(sequelize);
initRoundModel(sequelize);
initQuestionModel(sequelize);
initTeamModel(sequelize);
initSubmissionModel(sequelize);
initSubmissionResultModel(sequelize);
initWagerModel(sequelize);

Game.hasMany(Round, { foreignKey: 'gameId', as: 'rounds', onDelete: 'CASCADE' });
Round.belongsTo(Game, { foreignKey: 'gameId', as: 'game' });

Game.hasMany(Team, { foreignKey: 'gameId', as: 'teams', onDelete: 'CASCADE' });
Team.belongsTo(Game, { foreignKey: 'gameId', as: 'game' });

Round.hasMany(Question, { foreignKey: 'roundId', as: 'questions', onDelete: 'CASCADE' });
Question.belongsTo(Round, { foreignKey: 'roundId', as: 'round' });

Team.hasMany(Submission, { foreignKey: 'teamId', as: 'submissions', onDelete: 'CASCADE' });
Submission.belongsTo(Team, { foreignKey: 'teamId', as: 'team' });

Round.hasMany(Submission, { foreignKey: 'roundId', as: 'submissions', onDelete: 'CASCADE' });
Submission.belongsTo(Round, { foreignKey: 'roundId', as: 'round' });

Submission.hasMany(SubmissionResult, { foreignKey: 'submissionId', as: 'results', onDelete: 'CASCADE', hooks: true });
SubmissionResult.belongsTo(Submission, { foreignKey: 'submissionId', as: 'submission' });
SubmissionResult.belongsTo(Question, { foreignKey: 'questionId', as: 'question' });

Team.hasMany(Wager, { foreignKey: 'teamId', as: 'wagers', onDelete: 'CASCADE' });
Wager.belongsTo(Team, { foreignKey: 'teamId', as: 'team' });

Round.hasMany(Wager, { foreignKey: 'roundId', as: 'wagers', onDelete: 'CASCADE' });
Wager.belongsTo(Round, { foreignKey: 'roundId', as: 'round' });

Game.belongsTo(Round, { foreignKey: 'currentRoundId', as: 'currentRound' });

export async function initializeDatabase(): Promise<void> {
    await sequelize.authenticate();
    await sequelize.query('PRAGMA journal_mode = WAL;');
    await sequelize.query('PRAGMA foreign_keys = ON;');
    await sequelize.sync({ alter: true });
    await normalizeTeamIndexes();
}

export { Game, Question, Round, Submission, SubmissionResult, Team, Wager };

async function normalizeTeamIndexes(): Promise<void> {
    const queryInterface = sequelize.getQueryInterface();
    const indexes = (await queryInterface.showIndex('teams')) as Array<{
        name: string;
        unique: boolean;
        fields?: Array<
            | string
            | {
                attribute?: string;
                name?: string;
                field?: string;
            }
        >;
    }>;

    let hasCompositeIndex = false;

    for (const index of indexes) {
        const fields = (index.fields ?? []).map((field) => {
            if (typeof field === 'string') {
                return field;
            }
            return field.attribute ?? field.name ?? field.field ?? '';
        });
        const normalizedFields = fields.map((field: string) => field.replace(/`/g, ''));

        if (index.unique && normalizedFields.length === 2 && normalizedFields.includes('game_id') && normalizedFields.includes('name')) {
            hasCompositeIndex = true;
            continue;
        }

        if (index.unique && normalizedFields.length === 1 && (normalizedFields[0] === 'game_id' || normalizedFields[0] === 'name')) {
            const indexName = index.name ?? '';
            if (!indexName || indexName.startsWith('sqlite_autoindex')) {
                continue;
            }
            await queryInterface.removeIndex('teams', indexName);
        }
    }

    if (!hasCompositeIndex) {
        await queryInterface.addIndex('teams', {
            fields: ['game_id', 'name'],
            unique: true,
            name: 'teams_game_id_name_unique',
        });
    }
}
