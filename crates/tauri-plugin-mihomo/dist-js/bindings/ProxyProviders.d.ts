import type { ProxyProvider } from "./ProxyProvider";
export type ProxyProviders = {
    providers: {
        [key in string]?: ProxyProvider;
    };
};
