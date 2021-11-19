import { pino } from '@0x/api-utils';
import { LOGGER_INCLUDE_TIMESTAMP, LOG_LEVEL } from './config';
import { LogLevel } from './types'

export const logger = pino({
    formatters: {
        level: (label) => ({
            level: label,
        }),
    },
    level: LOG_LEVEL === LogLevel.NOTHING ? 'silent' : (Object.values(LogLevel)[LOG_LEVEL] as string).toLowerCase(),
    timestamp: LOGGER_INCLUDE_TIMESTAMP,
});
