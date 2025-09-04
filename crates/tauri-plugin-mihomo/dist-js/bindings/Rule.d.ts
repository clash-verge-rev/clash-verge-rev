import type { RuleType } from "./RuleType";
export type Rule = {
    type: RuleType;
    payload: string;
    proxy: string;
    size: number;
};
