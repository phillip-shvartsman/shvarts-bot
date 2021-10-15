import winston from "winston";

export const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.simple(),
    
    transports: [
      //
      // - Write all logs with level `error` and below to `error.log`
      // - Write all logs with level `info` and below to `combined.log`
      //
      new winston.transports.Console(),
      new winston.transports.File({ filename: 'error.log', level: 'error' }),
      new winston.transports.File({ filename: 'full.log' }),
    ],
  });