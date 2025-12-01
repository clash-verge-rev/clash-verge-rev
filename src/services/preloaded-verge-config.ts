let initialVergeConfig: IVergeConfig | null | undefined;

export const setInitialVergeConfig = (config: IVergeConfig | null) => {
  initialVergeConfig = config;
};

export const getInitialVergeConfig = () => initialVergeConfig;
