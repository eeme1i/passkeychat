export type AppVariables = {
  user: {
    id: string;
  };
};

export type AppEnv = {
  Bindings: {
    DB: D1Database;
    APP_ORIGIN: string;
    RP_ID: string;
    RP_NAME: string;
  };
  Variables: AppVariables;
};
