import "react-i18next";

import type { i18n, Namespace, TOptions, TFunction } from "i18next";
import type {
  UseTranslationOptions,
  UseTranslationResponse,
} from "react-i18next";

import type { TranslationKey } from "./generated/i18n-keys";

type EnforcedTranslationKey<Key extends string> = string extends Key
  ? string
  : Key extends TranslationKey
    ? Key
    : never;

type BaseTFunction = UseTranslationResponse<Namespace, undefined>[0];

type TypedTFunction = BaseTFunction &
  TFunction &
  (<Key extends string>(
    key: EnforcedTranslationKey<Key>,
    options?: TOptions | string,
  ) => string) &
  (<Key extends string>(
    key: readonly EnforcedTranslationKey<Key>[],
    options?: TOptions | string,
  ) => string);

declare module "react-i18next" {
  function useTranslation<KPrefix extends string = undefined>(
    ns?: Namespace | Namespace[],
    options?: UseTranslationOptions<KPrefix>,
  ): [t: TypedTFunction, i18n: i18n, ready: boolean] & {
    t: TypedTFunction;
    i18n: i18n;
    ready: boolean;
  };
}
