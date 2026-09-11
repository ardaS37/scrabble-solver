import { type Gaddag } from '@kamilmielnik/gaddag';
import { type Board, type Config, type ResultJson, type Tile } from '@scrabble-solver/types';

import { MoveGenerator } from './MoveGenerator';

export interface StarBonus {
  score: number;
  x: number;
  y: number;
}

export interface ScoringOptions {
  firstMoveWordMultiplier?: number;
  starBonus?: StarBonus;
}

export const solve = (
  gaddag: Gaddag,
  config: Config,
  board: Board,
  tiles: Tile[],
  scoringOptions?: ScoringOptions,
): ResultJson[] => {
  return new MoveGenerator(gaddag, config, board, tiles, scoringOptions).run();
};
