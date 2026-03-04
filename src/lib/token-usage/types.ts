export interface SessionUsageRow {
  key: string;
  agentId?: string;
  kind?: string;
  model?: string;
  modelProvider?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  updatedAt: number;
  ageMs?: number;
}

export interface ParsedSessionKeyMeta {
  isCron: boolean;
  cronJobId?: string;
  cronRunId?: string;
}

export interface DailyModelUsage {
  day: string;
  model: string;
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CronJobUsage {
  jobId: string;
  jobName: string;
  agentId?: string;
  enabled?: boolean;
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastUpdatedAt?: number;
  modelBreakdown: Array<{
    model: string;
    totalTokens: number;
    sessionCount: number;
  }>;
}

export interface BootstrapLoadFile {
  path: string;
  exists: boolean;
  bytes: number;
  estimatedTokens: number;
}

export interface BootstrapLoadEstimate {
  generatedAt: string;
  totalBytes: number;
  totalEstimatedTokens: number;
  files: BootstrapLoadFile[];
  missingFiles: string[];
}

export interface ContextFileEstimate {
  path: string;
  bytes: number;
  estimatedTokens: number;
}

export interface ContextFilesSnapshot {
  roots: Array<{
    path: string;
    files: number;
    bytes: number;
    estimatedTokens: number;
  }>;
  topFiles: ContextFileEstimate[];
  scannedFiles: number;
}

export interface TokenUsageRecommendation {
  id: string;
  severity: 'low' | 'medium' | 'high';
  category: 'startup' | 'context' | 'cron' | 'session';
  title: string;
  details: string;
  action: string;
}

export interface TokenUsageSnapshot {
  summary: {
    generatedAt: string;
    windowDays: number;
    totalSessions: number;
    dedupedSessions: number;
    totals: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      contextTokens: number;
    };
    byKind: Record<string, number>;
  };
  dailyByModel: DailyModelUsage[];
  cronUsage: CronJobUsage[];
  bootstrapLoad: BootstrapLoadEstimate;
  contextFiles: ContextFilesSnapshot;
  recommendations: TokenUsageRecommendation[];
  meta: {
    estimationMethod: string;
    notes: string[];
  };
}
