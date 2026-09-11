import { Game, type Locale } from '@scrabble-solver/types';
import {
  type ChangeEvent,
  type FunctionComponent,
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useDispatch } from 'react-redux';

import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import Image from '@/icons/Image.svg';
import { boardSlice, rackSlice, selectConfig, selectLocale, useTranslate, useTypedSelector } from '@/state';

import styles from './PhotoScanModal.module.scss';

interface Point {
  x: number;
  y: number;
}

type BoardCorners = [Point, Point] | [Point, Point, Point, Point];

interface Layout {
  board: BoardCorners;
  rack?: [Point, Point];
}

interface Props {
  className?: string;
  isOpen: boolean;
  onClose: () => void;
}

// Previous layouts included object-fit padding in their click coordinates.
const LAYOUT_STORAGE_KEY = 'scrabble-solver.photo-scan.layout.v2';
const LEGACY_LAYOUT_STORAGE_KEY = 'scrabble-solver.photo-scan.turkish.layout';
const SENSITIVITY_STORAGE_KEY = 'scrabble-solver.photo-scan.sensitivity';
const SCRABBLE_APPEARANCE_STORAGE_KEY = 'scrabble-solver.photo-scan.scrabble-appearance';

type ScanSensitivity = 'low' | 'balanced' | 'high';
type ScrabbleAppearance = 'light' | 'green';

interface ScanProfile {
  ink: 'dark' | 'light';
  isTilePixel: (red: number, green: number, blue: number) => boolean;
}

const DEFAULT_SCAN_PROFILE: ScanProfile = {
  ink: 'dark',
  isTilePixel: (red, green, blue) => red > green + 8 && green > blue + 40 && red > 160,
};

const SCRABBLE_SCAN_PROFILE: ScanProfile = {
  ink: 'dark',
  isTilePixel: (red, green, blue) => red > green + 8 && green > blue + 12 && red > 160,
};

const SCRABBLE_GREEN_SCAN_PROFILE: ScanProfile = {
  ink: 'dark',
  isTilePixel: (red, green, blue) => red > 170 && green > 155 && blue > 110 && red >= green - 12,
};

const CROSSPLAY_SCAN_PROFILE: ScanProfile = {
  ink: 'light',
  isTilePixel: (red, green, blue) => blue > 130 && blue > red + 45 && blue > green + 20,
};

const WYRAZY_SCAN_PROFILE: ScanProfile = {
  ink: 'dark',
  isTilePixel: (red, green, blue) => red > 190 && red > green + 35 && green > blue + 20 && blue < 145,
};

// Both games use coloured tile faces with dark capital letters. Their bonus cells
// are pale and patterned, while a placed tile has a saturated, solid face.
const COLOURED_TILES_SCAN_PROFILE: ScanProfile = {
  ink: 'dark',
  isTilePixel: (red, green, blue) => {
    const brightest = Math.max(red, green, blue);
    const darkest = Math.min(red, green, blue);
    return brightest - darkest > 65 && brightest > 110;
  },
};

function getScanProfile(game: Game, scrabbleAppearance: ScrabbleAppearance): ScanProfile {
  switch (game) {
    case Game.Crossplay:
      return CROSSPLAY_SCAN_PROFILE;
    case Game.Wyrazy:
      return WYRAZY_SCAN_PROFILE;
    case Game.Scrabble:
    case Game.ScrabbleDuel:
    case Game.SuperScrabble:
      return scrabbleAppearance === 'green' ? SCRABBLE_GREEN_SCAN_PROFILE : SCRABBLE_SCAN_PROFILE;
    case Game.LetterLeague:
    case Game.Literaki:
      return COLOURED_TILES_SCAN_PROFILE;
    default:
      return DEFAULT_SCAN_PROFILE;
  }
}

function getLayoutStorageKey(game: Game): string {
  return `${LAYOUT_STORAGE_KEY}.${game}`;
}

function detectGridAxis(energy: number[], cells: number): [number, number] | undefined {
  const length = energy.length;
  const minimumCellSize = Math.max(5, Math.floor((length * 0.42) / cells));
  const maximumCellSize = Math.floor(length / cells);
  let best: [number, number] | undefined;
  let bestScore = 0;

  for (let cellSize = minimumCellSize; cellSize <= maximumCellSize; cellSize += 1) {
    const extent = cellSize * cells;

    for (let start = 0; start + extent < length; start += 2) {
      let score = 0;

      for (let line = 0; line <= cells; line += 1) {
        const position = start + line * cellSize;
        score += Math.max(energy[position - 1] ?? 0, energy[position] ?? 0, energy[position + 1] ?? 0);
      }

      if (score > bestScore) {
        bestScore = score;
        best = [start, start + extent];
      }
    }
  }

  return best;
}

function detectGridBounds(image: HTMLImageElement, columns: number, rows: number): [Point, Point] | undefined {
  const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    return undefined;
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const verticalEnergy = Array.from({ length: width }, () => 0);
  const horizontalEnergy = Array.from({ length: height }, () => 0);

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const index = (y * width + x) * 4;
      const luminance = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
      const horizontal = (y * width + x + 1) * 4;
      const vertical = ((y + 1) * width + x) * 4;
      const horizontalLuminance = data[horizontal] * 0.2126 + data[horizontal + 1] * 0.7152 + data[horizontal + 2] * 0.0722;
      const verticalLuminance = data[vertical] * 0.2126 + data[vertical + 1] * 0.7152 + data[vertical + 2] * 0.0722;

      verticalEnergy[x] += Math.abs(luminance - horizontalLuminance);
      horizontalEnergy[y] += Math.abs(luminance - verticalLuminance);
    }
  }

  const horizontalBounds = detectGridAxis(verticalEnergy, columns);
  const verticalBounds = detectGridAxis(horizontalEnergy, rows);

  if (!horizontalBounds || !verticalBounds) {
    return undefined;
  }

  return [
    { x: horizontalBounds[0] / width, y: verticalBounds[0] / height },
    { x: horizontalBounds[1] / width, y: verticalBounds[1] / height },
  ];
}

function isPoint(point: unknown): point is Point {
  return (
    typeof point === 'object' &&
    point !== null &&
    'x' in point &&
    'y' in point &&
    typeof point.x === 'number' &&
    typeof point.y === 'number'
  );
}

function isCorners(corners: unknown): corners is [Point, Point] {
  return Array.isArray(corners) && corners.length === 2 && corners.every(isPoint);
}

function isBoardCorners(corners: unknown): corners is BoardCorners {
  return Array.isArray(corners) && (corners.length === 2 || corners.length === 4) && corners.every(isPoint);
}

function getSavedLayout(game: Game): Layout | undefined {
  try {
    const storageKey = getLayoutStorageKey(game);
    const serialized = window.localStorage.getItem(storageKey);
    const layout = JSON.parse(serialized ?? 'null') as unknown;

    if (isCorners(layout)) {
      return { board: layout };
    }

    if (typeof layout === 'object' && layout !== null && 'board' in layout && isBoardCorners(layout.board)) {
      const storedLayout = layout as { board: unknown; rack?: unknown };
      return isCorners(storedLayout.rack) ? { board: layout.board, rack: storedLayout.rack } : { board: layout.board };
    }
  } catch {
    window.localStorage.removeItem(getLayoutStorageKey(game));
  }

  return undefined;
}

function createPerspectiveCellSampler(image: HTMLImageElement, corners: [Point, Point, Point, Point]) {
  const source = document.createElement('canvas');
  const sourceContext = source.getContext('2d', { willReadFrequently: true });

  if (!sourceContext) {
    throw new Error('Unable to prepare image');
  }

  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  sourceContext.drawImage(image, 0, 0);
  const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height);

  return (x: number, y: number, columns: number, rows: number) => {
    const target = document.createElement('canvas');
    const targetContext = target.getContext('2d');

    if (!targetContext) {
      throw new Error('Unable to prepare image');
    }

    target.width = 160;
    target.height = 160;
    const targetPixels = targetContext.createImageData(target.width, target.height);

    for (let targetY = 0; targetY < target.height; targetY += 1) {
      for (let targetX = 0; targetX < target.width; targetX += 1) {
        const u = (x + (targetX + 0.5) / target.width) / columns;
        const v = (y + (targetY + 0.5) / target.height) / rows;
        const top = blend(corners[0], corners[1], u);
        const bottom = blend(corners[3], corners[2], u);
        const point = blend(top, bottom, v);
        const sourceX = Math.max(0, Math.min(source.width - 1, Math.floor(point.x * source.width)));
        const sourceY = Math.max(0, Math.min(source.height - 1, Math.floor(point.y * source.height)));
        const sourceIndex = (sourceY * source.width + sourceX) * 4;
        const targetIndex = (targetY * target.width + targetX) * 4;

        targetPixels.data[targetIndex] = sourcePixels.data[sourceIndex];
        targetPixels.data[targetIndex + 1] = sourcePixels.data[sourceIndex + 1];
        targetPixels.data[targetIndex + 2] = sourcePixels.data[sourceIndex + 2];
        targetPixels.data[targetIndex + 3] = sourcePixels.data[sourceIndex + 3];
      }
    }

    targetContext.putImageData(targetPixels, 0, 0);
    return target;
  };
}

function blend(first: Point, second: Point, factor: number): Point {
  return { x: first.x + (second.x - first.x) * factor, y: first.y + (second.y - first.y) * factor };
}

function getCellImage(
  image: HTMLImageElement | HTMLCanvasElement,
  corners: [Point, Point],
  grid: { x: number; y: number; columns: number; rows: number },
  sensitivity: ScanSensitivity,
  profile: ScanProfile,
) {
  const { x, y, columns, rows } = grid;
  const imageWidth = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const imageHeight = 'naturalHeight' in image ? image.naturalHeight : image.height;
  const left = Math.min(corners[0].x, corners[1].x) * imageWidth;
  const top = Math.min(corners[0].y, corners[1].y) * imageHeight;
  const width = (Math.abs(corners[1].x - corners[0].x) * imageWidth) / columns;
  const height = (Math.abs(corners[1].y - corners[0].y) * imageHeight) / rows;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to prepare image');
  }

  canvas.width = 240;
  canvas.height = 240;
  context.imageSmoothingEnabled = false;
  const horizontalInset = 0.08;
  const topInset = 0.06;
  const bottomInset = 0.06;
  context.drawImage(
    image,
    left + x * width + width * horizontalInset,
    top + y * height + height * topInset,
    width * (1 - horizontalInset * 2),
    height * (1 - topInset - bottomInset),
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let tilePixels = 0;
  let sampledPixels = 0;

  for (let index = 0; index < pixels.length; index += 32) {
    const [red, green, blue] = [pixels[index], pixels[index + 1], pixels[index + 2]];
    tilePixels += Number(profile.isTilePixel(red, green, blue));
    sampledPixels += 1;
  }

  const threshold = { low: 0.45, balanced: 0.3, high: 0.15 }[sensitivity];

  // A tile letter is small compared with its background. Turning a likely tile into
  // high-contrast black-on-white artwork gives the single-character OCR a much
  // cleaner input than the original screenshot, while the warm-surface check above
  // still keeps bonus-square labels out of the OCR pass.
  const ocrPixels = context.getImageData(0, 0, canvas.width, canvas.height);

  const luminances: number[] = [];
  for (let index = 0; index < pixels.length; index += 32) {
    luminances.push(pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722);
  }
  luminances.sort((a, b) => a - b);
  const inkThreshold = luminances[Math.floor(luminances.length * 0.65)] * 0.7;

  for (let index = 0; index < ocrPixels.data.length; index += 4) {
    const red = ocrPixels.data[index];
    const green = ocrPixels.data[index + 1];
    const blue = ocrPixels.data[index + 2];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const pixelX = (index / 4) % canvas.width;
    const pixelY = Math.floor(index / 4 / canvas.width);
    // Tile scores occupy the top-right corner; keep central dots and cedillas.
    const isScore = pixelX > canvas.width * 0.67 && pixelY < canvas.height * 0.42;
    const isInk = profile.ink === 'light' ? luminance > 185 : luminance < inkThreshold;
    const value = !isScore && isInk ? 0 : 255;

    ocrPixels.data[index] = value;
    ocrPixels.data[index + 1] = value;
    ocrPixels.data[index + 2] = value;
    ocrPixels.data[index + 3] = 255;
  }

  context.putImageData(ocrPixels, 0, 0);
  return {
    imageData: ocrPixels,
    isLikelyTile: tilePixels / sampledPixels > threshold,
    source: canvas.toDataURL('image/png'),
  };
}

function getRecognizedCharacter(text: string, alphabet: string[], locale: Locale): string {
  const normalizedTiles = new Map(alphabet.map((character) => [character.toLocaleUpperCase(locale), character]));
  return (
    Array.from(text.toLocaleUpperCase(locale))
      .map((character) => normalizedTiles.get(character))
      .find(Boolean) ?? ''
  );
}

const TEMPLATE_SIZE = 32;
const TILE_FONTS = ['Arial', 'Verdana', 'Tahoma', 'sans-serif'];
const tileTemplateCache = new Map<string, Array<{ character: string; mask: number[] }>>();

function normalizeMask(imageData: ImageData): number[] | undefined {
  const { data, width, height } = imageData;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i += 1) {
    ink[i] = Number(data[i * 4] < 100 && data[i * 4 + 1] < 100 && data[i * 4 + 2] < 100);
  }
  const visited = new Uint8Array(ink.length);
  const components: number[][] = [];
  for (let i = 0; i < ink.length; i += 1) {
    if (!ink[i] || visited[i]) {
      continue;
    }
    const component = [i];
    visited[i] = 1;
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      const pixel = component[cursor];
      const x = pixel % width;
      const neighbors = [pixel - width, pixel + width];
      if (x > 0) {
        neighbors.push(pixel - 1);
      }
      if (x < width - 1) {
        neighbors.push(pixel + 1);
      }
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && neighbor < ink.length && ink[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          component.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  const largest = Math.max(0, ...components.map((component) => component.length));
  if (largest < width * height * 0.005) {
    return undefined;
  }
  // Remove compression specks without losing detached Turkish diacritics.
  for (const component of components) {
    if (component.length < largest * 0.035) {
      for (const pixel of component) {
        ink[pixel] = 0;
      }
    }
  }
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isInk = ink[y * width + x];

      if (isInk) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (right < left || bottom < top || (right - left + 1) * (bottom - top + 1) < 40) {
    return undefined;
  }

  const contentWidth = right - left + 1;
  const contentHeight = bottom - top + 1;
  const mask: number[] = [];
  const scale = (TEMPLATE_SIZE - 4) / Math.max(contentWidth, contentHeight);
  const offsetX = (TEMPLATE_SIZE - contentWidth * scale) / 2;
  const offsetY = (TEMPLATE_SIZE - contentHeight * scale) / 2;

  for (let targetY = 0; targetY < TEMPLATE_SIZE; targetY += 1) {
    for (let targetX = 0; targetX < TEMPLATE_SIZE; targetX += 1) {
      const sourceX = left + Math.floor((targetX + 0.5 - offsetX) / scale);
      const sourceY = top + Math.floor((targetY + 0.5 - offsetY) / scale);
      if (sourceX < left || sourceX > right || sourceY < top || sourceY > bottom) {
        mask.push(0);
        continue;
      }
      mask.push(ink[sourceY * width + sourceX]);
    }
  }

  return mask;
}

function getTileTemplates(alphabet: string[], locale: Locale): Array<{ character: string; mask: number[] }> {
  const key = `${locale}:${alphabet.join('')}`;
  const cached = tileTemplateCache.get(key);

  if (cached) {
    return cached;
  }

  const templates = alphabet.flatMap((character) =>
    TILE_FONTS.map((font) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        return undefined;
      }

      canvas.width = 160;
      canvas.height = 160;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000';
      context.font = `700 112px ${font}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(character.toLocaleUpperCase(locale), 80, 84);
      const mask = normalizeMask(context.getImageData(0, 0, canvas.width, canvas.height));

      return mask ? { character, mask } : undefined;
    }).filter((template): template is { character: string; mask: number[] } => Boolean(template)),
  );

  tileTemplateCache.set(key, templates);
  return templates;
}

function recognizeTileCharacter(imageData: ImageData, alphabet: string[], locale: Locale): string {
  const mask = normalizeMask(imageData);

  if (!mask) {
    return '';
  }

  let bestCharacter = '';
  let bestDistance = Number.POSITIVE_INFINITY;
  const hasDetachedMark = (pixels: number[]) => {
    let seenInk = false;
    let seenGap = false;
    for (let y = 0; y < TEMPLATE_SIZE; y += 1) {
      const occupied = pixels.slice(y * TEMPLATE_SIZE, (y + 1) * TEMPLATE_SIZE).some(Boolean);
      if (occupied && seenGap) {
        return true;
      }
      if (!occupied && seenInk) {
        seenGap = true;
      }
      seenInk ||= occupied;
    }
    return false;
  };
  const detachedMark = hasDetachedMark(mask);

  for (const template of getTileTemplates(alphabet, locale)) {
    let distance = 0;
    let union = 0;

    for (let index = 0; index < mask.length; index += 1) {
      distance += Math.abs(mask[index] - template.mask[index]);
      union += Number(Boolean(mask[index] || template.mask[index]));
    }
    distance /= Math.max(1, union);
    if (hasDetachedMark(template.mask) !== detachedMark) {
      distance += 0.2;
    }

    if (distance < bestDistance) {
      bestDistance = distance;
      bestCharacter = template.character;
    }
  }

  return bestDistance <= 0.72 ? bestCharacter : '';
}

const PhotoScanModalBase: FunctionComponent<Props> = ({ className, isOpen, onClose }) => {
  const dispatch = useDispatch();
  const translate = useTranslate();
  const config = useTypedSelector(selectConfig);
  const locale = useTypedSelector(selectLocale);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [boardCorners, setBoardCorners] = useState<Point[]>([]);
  const [rackCorners, setRackCorners] = useState<Point[]>([]);
  const [isRackAlignmentEnabled, setIsRackAlignmentEnabled] = useState(false);
  const [alignmentTarget, setAlignmentTarget] = useState<'board' | 'rack'>('board');
  const [isPerspectiveAlignmentEnabled, setIsPerspectiveAlignmentEnabled] = useState(false);
  const [scanSensitivity, setScanSensitivity] = useState<ScanSensitivity>('balanced');
  const [scrabbleAppearance, setScrabbleAppearance] = useState<ScrabbleAppearance>('light');
  const [isSaved, setIsSaved] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scannedBoard, setScannedBoard] = useState<string[][]>();
  const [scannedRack, setScannedRack] = useState<string[]>();

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  useEffect(() => {
    const stored = window.localStorage.getItem(SENSITIVITY_STORAGE_KEY);

    if (stored === 'low' || stored === 'balanced' || stored === 'high') {
      setScanSensitivity(stored);
    }
  }, []);

  useEffect(() => {
    if (window.localStorage.getItem(SCRABBLE_APPEARANCE_STORAGE_KEY) === 'green') {
      setScrabbleAppearance('green');
    }
  }, []);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setScannedBoard(undefined);
    setScannedRack(undefined);
    setImageUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return URL.createObjectURL(file);
    });
    const savedLayout = getSavedLayout(config.game);
    setBoardCorners(savedLayout?.board ?? []);
    setRackCorners(savedLayout?.rack ?? []);
    setIsRackAlignmentEnabled(Boolean(savedLayout?.rack));
    setAlignmentTarget('board');
    setIsPerspectiveAlignmentEnabled(savedLayout?.board.length === 4);
    setIsSaved(Boolean(savedLayout));
  }, [config.game]);

  const handleImageClick = useCallback(
    (event: MouseEvent<HTMLImageElement>) => {
      const image = imageRef.current;

      if (!image) {
        return;
      }

      const bounds = image.getBoundingClientRect();
      const point = {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      };

      setIsSaved(false);
      const setCorners = alignmentTarget === 'rack' ? setRackCorners : setBoardCorners;
      const cornersCount = alignmentTarget === 'board' && isPerspectiveAlignmentEnabled ? 4 : 2;

      setCorners((current) => {
        const next = current.length === cornersCount ? [point] : [...current, point];

        return next;
      });
    },
    [alignmentTarget, isPerspectiveAlignmentEnabled],
  );

  const handleSaveLayout = useCallback(() => {
    if (boardCorners.length === (isPerspectiveAlignmentEnabled ? 4 : 2)) {
      const layout: Layout = { board: boardCorners as BoardCorners };

      if (rackCorners.length === 2) {
        layout.rack = rackCorners as [Point, Point];
      }

      window.localStorage.setItem(getLayoutStorageKey(config.game), JSON.stringify(layout));
      window.localStorage.removeItem(LEGACY_LAYOUT_STORAGE_KEY);
      setIsSaved(true);
    }
  }, [boardCorners, config.game, isPerspectiveAlignmentEnabled, rackCorners]);

  const handleResetLayout = useCallback(() => {
    window.localStorage.removeItem(getLayoutStorageKey(config.game));
    window.localStorage.removeItem(LEGACY_LAYOUT_STORAGE_KEY);
    setBoardCorners([]);
    setRackCorners([]);
    setIsRackAlignmentEnabled(false);
    setAlignmentTarget('board');
    setIsPerspectiveAlignmentEnabled(false);
    setIsSaved(false);
  }, [config.game]);

  const handleAutoAlign = useCallback(() => {
    const image = imageRef.current;

    if (!image) {
      return;
    }

    const bounds = detectGridBounds(image, config.boardWidth, config.boardHeight);

    if (bounds) {
      setBoardCorners(bounds);
      setAlignmentTarget('board');
      setIsPerspectiveAlignmentEnabled(false);
      setIsSaved(false);
    }
  }, [config.boardHeight, config.boardWidth]);

  const handleScan = useCallback(async () => {
    const image = imageRef.current;

    if (!image || !isBoardCorners(boardCorners)) {
      return;
    }

    setIsScanning(true);
    setScanFailed(false);
    setScanProgress(0);
    setScannedBoard(undefined);
    setScannedRack(undefined);

    try {
      const profile = getScanProfile(config.game, scrabbleAppearance);
      const perspectiveSampler =
        boardCorners.length === 4 ? createPerspectiveCellSampler(image, boardCorners) : undefined;
      const nextBoard = Array.from({ length: config.boardHeight }, () =>
        Array.from({ length: config.boardWidth }, () => ''),
      );

      for (let y = 0; y < config.boardHeight; y += 1) {
        for (let x = 0; x < config.boardWidth; x += 1) {
          const cell = perspectiveSampler ? perspectiveSampler(x, y, config.boardWidth, config.boardHeight) : undefined;

          const directCell = cell
            ? getCellImage(
                cell,
                [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ],
                { x: 0, y: 0, columns: 1, rows: 1 },
                scanSensitivity,
                profile,
              )
            : getCellImage(
                image,
                boardCorners as [Point, Point],
                { x, y, columns: config.boardWidth, rows: config.boardHeight },
                scanSensitivity,
                profile,
              );

          if (directCell.isLikelyTile) {
            nextBoard[y][x] = recognizeTileCharacter(directCell.imageData, config.alphabet, locale);
          }

          setScanProgress(
            Math.round(((y * config.boardWidth + x + 1) / (config.boardWidth * config.boardHeight)) * 100),
          );
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }

      if (rackCorners.length === 2) {
        const nextRack = Array.from({ length: config.rackSize }, () => '');

        for (let x = 0; x < config.rackSize; x += 1) {
          const cell = getCellImage(
            image,
            rackCorners as [Point, Point],
            { x, y: 0, columns: config.rackSize, rows: 1 },
            scanSensitivity,
            profile,
          );

          if (cell.isLikelyTile) {
            nextRack[x] = recognizeTileCharacter(cell.imageData, config.alphabet, locale);
          }
        }

        setScannedRack(nextRack);
      } else {
        setScannedRack(undefined);
      }

      setScannedBoard(nextBoard);
    } finally {
      setIsScanning(false);
    }
  }, [
    boardCorners,
    config.alphabet,
    config.boardHeight,
    config.boardWidth,
    config.game,
    config.rackSize,
    locale,
    rackCorners,
    scanSensitivity,
    scrabbleAppearance,
  ]);

  const handleCharacterChange = useCallback(
    (x: number, y: number, value: string) => {
      const character = getRecognizedCharacter(value, config.alphabet, locale);
      setScannedBoard((current) =>
        current?.map((row, rowIndex) =>
          row.map((cell, cellIndex) => (rowIndex === y && cellIndex === x ? character : cell)),
        ),
      );
    },
    [config.alphabet, locale],
  );

  const handleApplyBoard = useCallback(() => {
    scannedBoard?.forEach((row, y) =>
      row.forEach((value, x) => {
        dispatch(boardSlice.actions.changeCellValue({ value, x, y }));
      }),
    );
    if (scannedRack) {
      dispatch(rackSlice.actions.init(scannedRack.map((value) => value || null)));
    }
    onClose();
  }, [dispatch, onClose, scannedBoard, scannedRack]);

  const handleRackCharacterChange = useCallback(
    (index: number, value: string) => {
      const character = getRecognizedCharacter(value, config.alphabet, locale);
      setScannedRack((current) => current?.map((cell, cellIndex) => (cellIndex === index ? character : cell)));
    },
    [config.alphabet, locale],
  );

  const [boardFirstCorner, boardSecondCorner] = boardCorners;
  const [rackFirstCorner, rackSecondCorner] = rackCorners;
  const boardLeft = boardFirstCorner && boardSecondCorner ? Math.min(boardFirstCorner.x, boardSecondCorner.x) : 0;
  const boardTop = boardFirstCorner && boardSecondCorner ? Math.min(boardFirstCorner.y, boardSecondCorner.y) : 0;
  const boardWidth = boardFirstCorner && boardSecondCorner ? Math.abs(boardFirstCorner.x - boardSecondCorner.x) : 0;
  const boardHeight = boardFirstCorner && boardSecondCorner ? Math.abs(boardFirstCorner.y - boardSecondCorner.y) : 0;
  const rackLeft = rackFirstCorner && rackSecondCorner ? Math.min(rackFirstCorner.x, rackSecondCorner.x) : 0;
  const rackTop = rackFirstCorner && rackSecondCorner ? Math.min(rackFirstCorner.y, rackSecondCorner.y) : 0;
  const rackWidth = rackFirstCorner && rackSecondCorner ? Math.abs(rackFirstCorner.x - rackSecondCorner.x) : 0;
  const rackHeight = rackFirstCorner && rackSecondCorner ? Math.abs(rackFirstCorner.y - rackSecondCorner.y) : 0;
  const requiredBoardCorners = isPerspectiveAlignmentEnabled ? 4 : 2;
  const canSaveLayout =
    boardCorners.length === requiredBoardCorners && (!isRackAlignmentEnabled || rackCorners.length === 2);
  let alignmentInstructions:
    | 'photo-scan.calibration-instructions'
    | 'photo-scan.perspective-instructions'
    | 'photo-scan.rack-instructions' = 'photo-scan.calibration-instructions';
  if (isPerspectiveAlignmentEnabled) {
    alignmentInstructions = 'photo-scan.perspective-instructions';
  }
  if (alignmentTarget === 'rack') {
    alignmentInstructions = 'photo-scan.rack-instructions';
  }

  return (
    <Modal className={className} isOpen={isOpen} title={translate('photo-scan')} onClose={onClose}>
      <Modal.Section label={translate('photo-scan')} title={translate('photo-scan')}>
        <p className={styles.description}>{translate('photo-scan.description')}</p>

        <label className={styles.fileInput}>
          <Image aria-hidden="true" className={styles.fileIcon} role="img" />
          <span>{translate('photo-scan.choose-image')}</span>
          <input accept="image/*" className={styles.input} type="file" onChange={handleFileChange} />
        </label>
      </Modal.Section>

      {imageUrl && (
        <Modal.Section label={translate('photo-scan.calibrate')} title={translate('photo-scan.calibrate')}>
          <div className={styles.sensitivity}>
            <span>{translate('photo-scan.sensitivity')}</span>
            <div className={styles.sensitivityButtons}>
              {(['low', 'balanced', 'high'] as ScanSensitivity[]).map((sensitivity) => (
                <Button
                  aria-label={translate(`photo-scan.sensitivity.${sensitivity}`)}
                  className={styles.sensitivityButton}
                  key={sensitivity}
                  variant={scanSensitivity === sensitivity ? 'primary' : 'default'}
                  onClick={() => {
                    setScanSensitivity(sensitivity);
                    window.localStorage.setItem(SENSITIVITY_STORAGE_KEY, sensitivity);
                  }}
                >
                  {translate(`photo-scan.sensitivity.${sensitivity}`)}
                </Button>
              ))}
            </div>
          </div>

          {[Game.Scrabble, Game.ScrabbleDuel, Game.SuperScrabble].includes(config.game) && (
            <div className={styles.sensitivity}>
              <span>{translate('photo-scan.scrabble-appearance')}</span>
              <div className={styles.sensitivityButtons}>
                {(['light', 'green'] as ScrabbleAppearance[]).map((appearance) => (
                  <Button
                    aria-label={translate(`photo-scan.scrabble-appearance.${appearance}`)}
                    className={styles.sensitivityButton}
                    key={appearance}
                    variant={scrabbleAppearance === appearance ? 'primary' : 'default'}
                    onClick={() => {
                      setScrabbleAppearance(appearance);
                      window.localStorage.setItem(SCRABBLE_APPEARANCE_STORAGE_KEY, appearance);
                    }}
                  >
                    {translate(`photo-scan.scrabble-appearance.${appearance}`)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <p className={styles.description}>{translate(alignmentInstructions)}</p>

          <div className={styles.preview}>
            <img alt="" className={styles.image} ref={imageRef} src={imageUrl} onClick={handleImageClick} />

            {boardCorners.map((corner, index) => (
              <span
                aria-hidden="true"
                className={styles.corner}
                key={index}
                style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
              >
                {isPerspectiveAlignmentEnabled && index + 1}
              </span>
            ))}

            {!isPerspectiveAlignmentEnabled && boardWidth > 0 && boardHeight > 0 && (
              <span
                aria-label={translate('photo-scan.calibrate')}
                className={styles.grid}
                style={{
                  backgroundSize: `calc(100% / ${config.boardWidth}) calc(100% / ${config.boardHeight})`,
                  height: `${boardHeight * 100}%`,
                  left: `${boardLeft * 100}%`,
                  top: `${boardTop * 100}%`,
                  width: `${boardWidth * 100}%`,
                }}
              />
            )}

            {rackFirstCorner && (
              <span
                aria-hidden="true"
                className={styles.rackCorner}
                style={{ left: `${rackFirstCorner.x * 100}%`, top: `${rackFirstCorner.y * 100}%` }}
              />
            )}

            {rackSecondCorner && (
              <span
                aria-hidden="true"
                className={styles.rackCorner}
                style={{ left: `${rackSecondCorner.x * 100}%`, top: `${rackSecondCorner.y * 100}%` }}
              />
            )}

            {rackWidth > 0 && rackHeight > 0 && (
              <span
                aria-label={translate('photo-scan.rack')}
                className={styles.rackGrid}
                style={{
                  backgroundSize: `calc(100% / ${config.rackSize}) 100%`,
                  height: `${rackHeight * 100}%`,
                  left: `${rackLeft * 100}%`,
                  top: `${rackTop * 100}%`,
                  width: `${rackWidth * 100}%`,
                }}
              >
                <span className={styles.rackLabel}>{`${config.rackSize} ${translate('common.tiles')}`}</span>
              </span>
            )}
          </div>

          <div className={styles.actions}>
            <Button
              aria-label={translate('photo-scan.reset-layout')}
              className={styles.secondaryAction}
              onClick={handleResetLayout}
            >
              {translate('photo-scan.reset-layout')}
            </Button>

            <Button
              aria-label={translate('photo-scan.auto-align')}
              className={styles.secondaryAction}
              onClick={handleAutoAlign}
            >
              {translate('photo-scan.auto-align')}
            </Button>

            {alignmentTarget === 'board' && !isRackAlignmentEnabled && (
              <Button
                aria-label={translate('photo-scan.perspective')}
                className={styles.secondaryAction}
                onClick={() => {
                  setIsPerspectiveAlignmentEnabled((current) => !current);
                  setBoardCorners([]);
                  setIsSaved(false);
                }}
              >
                {translate('photo-scan.perspective')}
              </Button>
            )}

            {alignmentTarget === 'board' && !isRackAlignmentEnabled && boardCorners.length === requiredBoardCorners && (
              <Button
                aria-label={translate('photo-scan.align-rack')}
                className={styles.secondaryAction}
                onClick={() => {
                  setIsRackAlignmentEnabled(true);
                  setRackCorners([]);
                  setAlignmentTarget('rack');
                  setIsSaved(false);
                }}
              >
                {translate('photo-scan.align-rack')}
              </Button>
            )}

            {(canSaveLayout || isSaved) && (
              <div className={styles.primaryActions}>
                {canSaveLayout && (
                  <Button aria-label={translate('photo-scan.save-layout')} variant="primary" onClick={handleSaveLayout}>
                    {translate('photo-scan.save-layout')}
                  </Button>
                )}

                {isSaved && (
                  <Button
                    aria-label={translate('photo-scan.scan')}
                    disabled={isScanning}
                    variant="primary"
                    onClick={() => {
                      handleScan().catch(() => setScanFailed(true));
                    }}
                  >
                    {isScanning ? `${translate('photo-scan.scanning')} ${scanProgress}%` : translate('photo-scan.scan')}
                  </Button>
                )}
              </div>
            )}
          </div>

          {isSaved && (
            <p aria-live="polite" className={styles.saved}>
              {translate('photo-scan.saved')}
            </p>
          )}
        </Modal.Section>
      )}

      {scanFailed && <p role="alert">{translate('empty-state.error')}</p>}

      {scannedBoard && (
        <Modal.Section label={translate('photo-scan.review')} title={translate('photo-scan.review')}>
          <p className={styles.description}>{translate('photo-scan.review-instructions')}</p>
          <div
            className={styles.reviewBoard}
            style={{ gridTemplateColumns: `repeat(${config.boardWidth}, minmax(0, 1fr))` }}
          >
            {scannedBoard.flatMap((row, y) =>
              row.map((value, x) => (
                <input
                  aria-label={`${x + 1}, ${y + 1}`}
                  className={styles.reviewCell}
                  key={`${x}-${y}`}
                  lang={locale}
                  maxLength={1}
                  value={value}
                  onChange={(event) => handleCharacterChange(x, y, event.target.value)}
                />
              )),
            )}
          </div>
          <div className={styles.actions}>
            <Button aria-label={translate('photo-scan.apply')} variant="primary" onClick={handleApplyBoard}>
              {translate('photo-scan.apply')}
            </Button>
          </div>
        </Modal.Section>
      )}

      {scannedRack && (
        <Modal.Section label={translate('photo-scan.rack')} title={translate('photo-scan.rack')}>
          <p className={styles.description}>{translate('photo-scan.review-instructions')}</p>
          <div
            className={styles.reviewRack}
            style={{ gridTemplateColumns: `repeat(${config.rackSize}, minmax(0, 1fr))` }}
          >
            {scannedRack.map((value, index) => (
              <input
                aria-label={`${translate('photo-scan.rack')} ${index + 1}`}
                className={styles.reviewCell}
                key={index}
                lang={locale}
                maxLength={1}
                value={value}
                onChange={(event) => handleRackCharacterChange(index, event.target.value)}
              />
            ))}
          </div>
        </Modal.Section>
      )}
    </Modal>
  );
};

export const PhotoScanModal = memo(PhotoScanModalBase);
