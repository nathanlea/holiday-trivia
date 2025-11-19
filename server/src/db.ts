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
}

export { Game, Question, Round, Submission, SubmissionResult, Team, Wager };
