const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export const log = {
  info: (msg: string) => console.log(msg),
  success: (msg: string) => console.log(`${GREEN}[OK]${RESET} ${msg}`),
  warn: (msg: string) => console.log(`${YELLOW}[WARN]${RESET} ${msg}`),
  error: (msg: string) => console.error(`${RED}[ERR]${RESET} ${msg}`),
  step: (msg: string) => console.log(`\n${CYAN}==>${RESET} ${msg}`),
  dim: (msg: string) => console.log(`${DIM}${msg}${RESET}`),
};
