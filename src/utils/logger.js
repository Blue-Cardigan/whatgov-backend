const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

class Logger {
  constructor() {
    this.level = process.env.LOG_LEVEL || 'DEBUG';
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : arg
    ).join(' ');
    
    return `[${timestamp}] ${level}: ${message} ${formattedArgs}`;
  }

  error(message, ...args) {
    if (LOG_LEVELS[this.level] >= LOG_LEVELS.ERROR) {
      console.error(this.formatMessage('ERROR', message, ...args));
    }
  }

  warn(message, ...args) {
    if (LOG_LEVELS[this.level] >= LOG_LEVELS.WARN) {
      console.warn(this.formatMessage('WARN', message, ...args));
    }
  }

  info(message, ...args) {
    if (LOG_LEVELS[this.level] >= LOG_LEVELS.INFO) {
      console.info(this.formatMessage('INFO', message, ...args));
    }
  }

  debug(message, ...args) {
    if (LOG_LEVELS[this.level] >= LOG_LEVELS.DEBUG) {
      console.debug(this.formatMessage('DEBUG', message, ...args));
    }
  }
}

export default new Logger(); 