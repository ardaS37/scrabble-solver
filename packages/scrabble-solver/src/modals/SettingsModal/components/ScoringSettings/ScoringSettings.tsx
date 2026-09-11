import { type ChangeEvent, type FunctionComponent } from 'react';
import { useDispatch } from 'react-redux';

import { Radio } from '@/components/Radio';
import {
  selectFirstMoveWordMultiplier,
  selectStarBonusEnabled,
  selectStarBonusScore,
  settingsSlice,
  useTranslate,
  useTypedSelector,
} from '@/state';

import styles from './ScoringSettings.module.scss';

interface Props {
  disabled?: boolean;
}

export const ScoringSettings: FunctionComponent<Props> = ({ disabled }) => {
  const dispatch = useDispatch();
  const translate = useTranslate();
  const firstMoveWordMultiplier = useTypedSelector(selectFirstMoveWordMultiplier);
  const starBonusEnabled = useTypedSelector(selectStarBonusEnabled);
  const starBonusScore = useTypedSelector(selectStarBonusScore);

  const handleFirstMoveChange = (event: ChangeEvent<HTMLInputElement>) => {
    dispatch(settingsSlice.actions.changeFirstMoveWordMultiplier(event.target.value === 'on'));
  };

  const handleStarBonusChange = (event: ChangeEvent<HTMLInputElement>) => {
    dispatch(settingsSlice.actions.changeStarBonusEnabled(event.target.value === 'on'));
  };

  const handleStarScoreChange = (event: ChangeEvent<HTMLInputElement>) => {
    dispatch(settingsSlice.actions.changeStarBonusScore(Number(event.target.value)));
  };

  return (
    <div className={styles.settings}>
      <SettingRadios
        checked={firstMoveWordMultiplier}
        disabled={disabled}
        name="firstMoveWordMultiplier"
        onChange={handleFirstMoveChange}
      >
        {translate('settings.firstMoveWordMultiplier')}
      </SettingRadios>

      <SettingRadios checked={starBonusEnabled} disabled={disabled} name="starBonus" onChange={handleStarBonusChange}>
        {translate('settings.starBonus')}
      </SettingRadios>

      <label className={styles.score}>
        <span>{translate('settings.starBonusScore')}</span>
        <input
          disabled={disabled || !starBonusEnabled}
          min="0"
          type="number"
          value={starBonusScore}
          onChange={handleStarScoreChange}
        />
      </label>
    </div>
  );
};

interface SettingRadiosProps {
  checked: boolean;
  children: string;
  disabled?: boolean;
  name: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

const SettingRadios: FunctionComponent<SettingRadiosProps> = ({ checked, children, disabled, name, onChange }) => (
  <SettingRadiosContent checked={checked} disabled={disabled} name={name} onChange={onChange}>
    {children}
  </SettingRadiosContent>
);

const SettingRadiosContent: FunctionComponent<SettingRadiosProps> = ({ checked, children, disabled, name, onChange }) => {
  const translate = useTranslate();

  return (
    <div className={styles.radioGroup}>
      <div className={styles.label}>{children}</div>
      <div className={styles.radios}>
        <Radio checked={!checked} disabled={disabled} name={name} value="off" onChange={onChange}>
          {translate('common.off')}
        </Radio>
        <Radio checked={checked} disabled={disabled} name={name} value="on" onChange={onChange}>
          {translate('common.on')}
        </Radio>
      </div>
    </div>
  );
};
