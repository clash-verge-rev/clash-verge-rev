import type { RuleProvider } from "./RuleProvider";
export type RuleProviders = {
    providers: {
        [key in string]?: RuleProvider;
    };
};
