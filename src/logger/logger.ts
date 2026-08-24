import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV || 'production'
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true, // Adds color-coded log levels
          translateTime: "SYS:standard", // Formats timestamp to a readable date
          ignore: "pid,hostname", // Hides noisy metadata fields
        },
      },
});