import {
    CreationOptional,
    DataTypes,
    InferAttributes,
    InferCreationAttributes,
    Model,
    NonAttribute,
    Sequelize,
} from 'sequelize';
import type { Game } from './game';
import type { Submission } from './submission';
import type { Wager } from './wager';

export class Team extends Model<InferAttributes<Team>, InferCreationAttributes<Team>> {
    declare id: CreationOptional<string>;
    declare gameId: string;
    declare name: string;
    declare joinToken: string;
    declare score: number;
    declare createdAt: string;

    declare game?: NonAttribute<Game>;
    declare submissions?: NonAttribute<Submission[]>;
    declare wagers?: NonAttribute<Wager[]>;
}

export function initTeamModel(sequelize: Sequelize): typeof Team {
    Team.init(
        {
            id: {
                type: DataTypes.STRING,
                primaryKey: true,
            },
            gameId: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'game_id',
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            joinToken: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'join_token',
            },
            score: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            createdAt: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'created_at',
            },
        },
        {
            sequelize,
            tableName: 'teams',
            underscored: true,
            timestamps: false,
            indexes: [
                {
                    unique: true,
                    fields: ['game_id', 'name'],
                },
            ],
        },
    );

    return Team;
}
