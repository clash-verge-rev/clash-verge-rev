import type { ProviderType } from "./ProviderType";
import type { RuleBehavior } from "./RuleBehavior";
import type { RuleFormat } from "./RuleFormat";
import type { VehicleType } from "./VehicleType";
export type RuleProvider = {
    behavior: RuleBehavior;
    format: RuleFormat;
    name: string;
    ruleCount: number;
    type: ProviderType;
    updatedAt: string;
    vehicleType: VehicleType;
};
