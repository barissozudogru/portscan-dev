export interface PortProcess {
  port: number;
  pid: number;
  process: string;
  command: string;
  uptime: string;
}

export interface ScanOptions {
  ports?: number[];
  portRange?: [number, number];
}

export interface KillOptions {
  ports: number[];
  signal?: NodeJS.Signals;
}

export interface KillResult {
  port: number;
  pid: number;
  // Every pid signaled for this port. A port can be held by several processes
  // at once, and all of them must be signaled before it frees up. Equals
  // [pid] unless the port was shared.
  pids?: number[];
  success: boolean;
  error?: string;
}
