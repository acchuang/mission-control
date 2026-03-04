import type { ExecutionProfile, Task } from './types';

export const GEMINI_FALLBACK_MODEL = 'google-gemini-cli/gemini-2.5-pro';

export type ModelRoute = {
  model: string;
  reason: string;
};

/**
 * Cost-aware model routing policy.
 *
 * Priority order:
 * - Urgent/high and planning-heavy tasks -> stronger model
 * - Routine execution -> cheaper model
 * - Fallbacks configured in OpenClaw handle provider outages
 */
export function routeModelForTask(task: Pick<Task, 'priority' | 'title' | 'description' | 'status' | 'execution_profile'>): ModelRoute {
  const profile = (task.execution_profile || 'auto') as ExecutionProfile;

  if (profile === 'cost') {
    return { model: 'openai-codex/gpt-5.2', reason: 'task set to Cost mode' };
  }

  if (profile === 'quality') {
    return { model: 'openai-codex/gpt-5.3-codex', reason: 'task set to Quality mode' };
  }

  if (profile === 'gemini') {
    return { model: GEMINI_FALLBACK_MODEL, reason: 'task set to Gemini mode' };
  }

  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();

  const planningHeavy = /(plan|architecture|design|spec|research|strategy|complex|migration|refactor)/i.test(text);
  const codingHeavy = /(implement|build|code|fix|debug|test|deploy)/i.test(text);

  if (task.priority === 'urgent' || task.priority === 'high') {
    return {
      model: 'openai-codex/gpt-5.3-codex',
      reason: 'high-priority task',
    };
  }

  if (planningHeavy && !codingHeavy) {
    return {
      model: 'openai-codex/gpt-5.3-codex',
      reason: 'planning/research-heavy task',
    };
  }

  return {
    model: 'openai-codex/gpt-5.2',
    reason: 'cost-effective default for routine execution',
  };
}
