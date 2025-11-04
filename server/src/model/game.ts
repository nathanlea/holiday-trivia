import {
    CreationOptional,
    DataTypes,
    InferAttributes,
    InferCreationAttributes,
    Model,
    NonAttribute,
    Sequelize,
} from 'sequelize';
import type { Round } from './round';
import type { Team } from './team';

export class Game extends Model<InferAttributes<Game>, InferCreationAttributes<Game>> {
    declare id: CreationOptional<string>;
    declare code: string;
    declare title: string;
    declare pinHash: string;
    declare createdAt: string;
    declare currentRoundId: string | null;

    declare rounds?: NonAttribute<Round[]>;
    declare teams?: NonAttribute<Team[]>;
    declare currentRound?: NonAttribute<Round | null>;
}

export function initGameModel(sequelize: Sequelize): typeof Game {
    Game.init(
        {
            id: {
                type: DataTypes.STRING,
                primaryKey: true,
            },
            code: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
            },
            title: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            pinHash: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'pin_hash',
            },
            createdAt: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'created_at',
            },
            currentRoundId: {
                type: DataTypes.STRING,
                allowNull: true,
                field: 'current_round_id',
            },
        },
        {
            sequelize,
            tableName: 'games',
            underscored: true,
            timestamps: false,
        },
    );

    return Game;
}
