import { getConfig, hasConfig } from '@scrabble-solver/configs';
import { BLANK } from '@scrabble-solver/constants';
import { dictionaries } from '@scrabble-solver/dictionaries';
import { logEvent } from '@scrabble-solver/logger';
import { solve as solveScrabble, type ScoringOptions } from '@scrabble-solver/solver';
import {
  Board,
  type Config,
  type Game,
  type Locale,
  Tile,
  isBoardJson,
  isGame,
  isLocale,
} from '@scrabble-solver/types';
import { type NextApiRequest, type NextApiResponse } from 'next';

import { type ApiContext, BadRequestError, isBoardValid, isCharacterValid, withApiLog } from '@/api';
import { isStringArray } from '@/lib/isStringArray';

interface RequestData {
  board: Board;
  characters: string[];
  config: Config;
  game: Game;
  locale: Locale;
  scoringOptions: ScoringOptions;
}

export default withApiLog('solve', solve);

async function solve(request: NextApiRequest, response: NextApiResponse, { ip, getElapsedMs }: ApiContext) {
  const { board, characters, config, game, locale, scoringOptions } = parseRequest(request);
  const gaddag = await dictionaries.get(locale);
  const tiles = characters.map((character) => new Tile({ character, isBlank: character === BLANK }));
  const results = solveScrabble(gaddag, config, board, tiles, scoringOptions);
  response.status(200).send(results);

  logEvent({
    type: 'solve',
    ip,
    ms: getElapsedMs(),
    locale,
    game,
    tiles: board.getTilesCount(),
    blanks: board.getBlanksCount(),
    rack: characters.join(','),
    results: results.length,
  });
}

function parseRequest(request: NextApiRequest): RequestData {
  const { board: boardJson, characters, firstMoveWordMultiplier, game, locale, starBonus } = request.body;

  if (!isLocale(locale)) {
    throw new BadRequestError('Invalid "locale" parameter');
  }

  if (!isGame(game)) {
    throw new BadRequestError('Invalid "game" parameter');
  }

  if (!isStringArray(characters) || characters.length === 0) {
    throw new BadRequestError('Invalid "characters" parameter');
  }

  if (!hasConfig(game, locale)) {
    throw new BadRequestError(`No game "${game}" in "${locale}"`);
  }

  const config = getConfig(game, locale);

  for (const character of characters) {
    if (!isCharacterValid(character)) {
      throw new BadRequestError('Invalid "characters" parameter');
    }
  }

  const blanksCount = characters.filter((character) => character === BLANK).length;

  if (blanksCount > config.blanksCount) {
    throw new BadRequestError('Too many blank tiles passed');
  }

  if (!isBoardJson(boardJson) || !isBoardValid(boardJson, config)) {
    throw new BadRequestError('Invalid "board" parameter');
  }

  const board = Board.fromJson(boardJson);
  const scoringOptions: ScoringOptions = {};

  if (firstMoveWordMultiplier === 2) {
    scoringOptions.firstMoveWordMultiplier = 2;
  }

  if (
    starBonus &&
    typeof starBonus.score === 'number' &&
    Number.isFinite(starBonus.score) &&
    Number.isInteger(starBonus.x) &&
    Number.isInteger(starBonus.y) &&
    starBonus.x >= 0 &&
    starBonus.x < config.boardWidth &&
    starBonus.y >= 0 &&
    starBonus.y < config.boardHeight
  ) {
    scoringOptions.starBonus = { score: Math.max(0, Math.round(starBonus.score)), x: starBonus.x, y: starBonus.y };
  }

  return {
    board,
    characters,
    config,
    game,
    locale,
    scoringOptions,
  };
}

export const config = {
  api: {
    responseLimit: '25mb',
  },
};
