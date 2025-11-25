export interface ProcessInfo {
  id: number;
  name: string;
  pm_cwd: string;
  repo?: string;
  branch?: string;
}

export interface ErrorContext {
  processId: number;
  processName: string;
  errorMessage: string;
  stackTrace: string;
  logContext: string[];
  repo?: string;
  branch?: string;
  timestamp: Date;
}
