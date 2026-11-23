import { useTranslation } from "react-i18next";
import type en from "./locales/en.json";

type TranslationKeys = typeof en;

type DotPrefix<T extends string, K extends string> = K extends string ? `${T}.${K}` : never;

type DotPaths<T> = T extends Record<string, unknown>
  ? {
      [K in keyof T & string]: K | (T[K] extends Record<string, unknown> ? DotPaths<T[K]> extends infer D ? D extends string ? DotPrefix<K, D> : never : never : K);
    }[keyof T & string]
  : never;

export type TranslationKey = DotPaths<TranslationKeys> | keyof TranslationKeys;

export function useT() {
  const { t } = useTranslation();

  function translate(key: TranslationKey, options?: Record<string, unknown>): string {
    return t(key, options ?? {});
  }

  return translate;
}
