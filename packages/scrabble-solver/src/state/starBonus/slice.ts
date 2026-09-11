import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type Point } from '@/types';

import { type StarBonusState } from './types';

const initialState = null as StarBonusState;

export const starBonusSlice = createSlice({
  initialState,
  name: 'starBonus',
  reducers: {
    clear: () => initialState,
    set: (_state, action: PayloadAction<Point>) => action.payload,
  },
});
