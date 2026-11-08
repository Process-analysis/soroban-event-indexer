import pino, { type Logger, type LoggerOptions } from "pino";

let globalLogger: Logger | null = null;

export function createLogger(level: string = "info"): Logger {
  const isDev = process.env["NODE_ENV"] !== "production" && !process.env["CI"];

  const opts: LoggerOptions = {
    level,
  };

  if (isDev) {
    opts.transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  }

  globalLogger = pino(opts);
  return globalLogger;
}

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = createLogger();
  }
  return globalLogger;
}
