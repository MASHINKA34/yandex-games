import ygConfig from '../yg.config.json';
import { sdkLang } from './yg';

const STRINGS = {
  ru: {
    play: 'Играть',
    finish: 'Закончить',
    again: 'Ещё раз',
    bonus: 'Бонус за рекламу: +1',
    timeLeft: 'Осталось: {s} с',
    roundOver: 'Раунд окончен',
    rounds: 'Раундов: {n}',
    bonuses: 'Бонусов: {n}',
  },
  en: {
    play: 'Play',
    finish: 'Finish',
    again: 'Play again',
    bonus: 'Watch ad: +1 bonus',
    timeLeft: 'Time left: {s} s',
    roundOver: 'Round over',
    rounds: 'Rounds: {n}',
    bonuses: 'Bonuses: {n}',
  },
};

export type StringKey = keyof (typeof STRINGS)['ru'];
type Lang = keyof typeof STRINGS;

const RU_FALLBACK = ['ru', 'be', 'kk', 'uk', 'uz'];

export function lang(): Lang {
  return RU_FALLBACK.includes(sdkLang()) ? 'ru' : 'en';
}

export function t(key: StringKey, params: Record<string, string | number> = {}): string {
  return STRINGS[lang()][key].replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function gameTitle(): string {
  return ygConfig.title[lang()];
}
