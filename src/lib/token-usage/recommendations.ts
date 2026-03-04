import type { BootstrapLoadEstimate, ContextFilesSnapshot, CronJobUsage, SessionUsageRow, TokenUsageRecommendation } from './types';

export interface RecommendationInputs {
  sessions: SessionUsageRow[];
  cronUsage: CronJobUsage[];
  bootstrapLoad: BootstrapLoadEstimate;
  contextFiles: ContextFilesSnapshot;
}

export function buildTokenUsageRecommendations(input: RecommendationInputs): TokenUsageRecommendation[] {
  const out: TokenUsageRecommendation[] = [];

  if (input.bootstrapLoad.totalEstimatedTokens > 8000) {
    out.push({
      id: 'startup-heavy',
      severity: 'high',
      category: 'startup',
      title: 'New-session bootstrap load is heavy',
      details: `Estimated startup load is ~${input.bootstrapLoad.totalEstimatedTokens.toLocaleString()} tokens.`,
      action: 'Archive older daily memory into summaries and trim startup-critical files (AGENTS/MEMORY).',
    });
  }

  const biggestContextFile = input.contextFiles.topFiles[0];
  if (biggestContextFile && biggestContextFile.estimatedTokens > 10000) {
    out.push({
      id: 'context-hotspot',
      severity: 'high',
      category: 'context',
      title: 'Largest context file dominates token budget',
      details: `${biggestContextFile.path} is ~${biggestContextFile.estimatedTokens.toLocaleString()} tokens.`,
      action: 'Split file by topic and load only scoped sections via INDEX/SUMMARY routing.',
    });
  }

  const topCron = [...input.cronUsage].sort((a, b) => b.totalTokens - a.totalTokens)[0];
  if (topCron && topCron.totalTokens > 30000) {
    out.push({
      id: 'cron-cost',
      severity: 'medium',
      category: 'cron',
      title: 'Top cron job has high token spend',
      details: `${topCron.jobName} uses ~${topCron.totalTokens.toLocaleString()} tokens over sampled sessions.`,
      action: 'Downgrade model for that cron job or shorten prompt/context payload.',
    });
  }

  const nearLimitSessions = input.sessions.filter((s) => {
    if (!s.contextTokens || s.contextTokens <= 0) return false;
    // Heuristic: OpenClaw commonly set at 272k context in this workspace.
    return s.contextTokens >= 0.8 * 272000;
  });

  if (nearLimitSessions.length > 0) {
    out.push({
      id: 'context-pressure',
      severity: 'medium',
      category: 'session',
      title: 'Some sessions are operating near context limits',
      details: `${nearLimitSessions.length} session(s) are at or above ~80% context capacity.`,
      action: 'Move verbose logs to files sooner and enforce shorter per-turn result capsules.',
    });
  }

  if (out.length === 0) {
    out.push({
      id: 'healthy-baseline',
      severity: 'low',
      category: 'session',
      title: 'Token usage is within current guardrails',
      details: 'No major hotspots detected in sampled data.',
      action: 'Keep monitoring and re-run audit after major workflow changes.',
    });
  }

  return out;
}
