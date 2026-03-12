export interface PortProcess {
  port: number;
  pid: number;
  process: string;
  uptime: string;
}

export interface ScanOptions {
  json?: boolean;
  ports?: number[];
}

export interface KillOptions {
  ports: number[];
  signal?: NodeJS.Signals;
}

export interface KillResult {
  port: number;
  pid: number;
  success: boolean;
  error?: string;
}
