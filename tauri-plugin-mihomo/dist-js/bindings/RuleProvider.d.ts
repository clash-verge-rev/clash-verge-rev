import type { ProviderType } from "./ProviderType";
export type RuleProvider = {
    behavior: string;
    format: string;
    name: string;
    ruleCount: number;
    type: ProviderType;
    updatedAt: string;
    vehicleType: string;
};
