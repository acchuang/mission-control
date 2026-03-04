'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  ChevronRight,
  GripVertical,
  Monitor,
  AlertTriangle,
  Clock3,
  CheckCircle2,
  Activity,
  BrainCircuit,
  ArrowRightLeft,
  ListTodo,
} from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import type { Task, TaskStatus } from '@/lib/types';
import { TaskModal } from './TaskModal';
import { OfficeCanvas } from './OfficeCanvas';
import { formatDistanceToNow } from 'date-fns';

interface MissionQueueProps {
  workspaceId?: string;
}

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'planning', label: 'PLANNING', color: 'border-t-mc-accent-purple' },
  { id: 'inbox', label: 'INBOX', color: 'border-t-mc-accent-pink' },
  { id: 'assigned', label: 'ASSIGNED', color: 'border-t-mc-accent-yellow' },
  { id: 'in_progress', label: 'IN PROGRESS', color: 'border-t-mc-accent' },
  { id: 'testing', label: 'TESTING', color: 'border-t-mc-accent-cyan' },
  { id: 'review', label: 'REVIEW', color: 'border-t-mc-accent-purple' },
  { id: 'done', label: 'DONE', color: 'border-t-mc-accent-green' },
];

export function MissionQueue({ workspaceId }: MissionQueueProps) {
  const { tasks, events, agents, updateTaskStatus, addEvent } = useMissionControl();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);

  const [metricOrder, setMetricOrder] = useState<string[]>(['running', 'blocked', 'failures', 'deadline', 'throughput']);
  const [opsOrder, setOpsOrder] = useState<string[]>(['needs_you', 'live_feed']);
  const [intelOrder, setIntelOrder] = useState<string[]>(['model_tracking', 'personal_tracker', 'workflow_visibility']);

  const getTasksByStatus = (status: TaskStatus) => tasks.filter((task) => task.status === status);

  const metrics = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const runningAgents = agents.filter((a) => a.status === 'working').length;
    const blockedTasks = tasks.filter((t) => t.status === 'review' || t.status === 'testing').length;
    const openTasks = tasks.filter((t) => t.status !== 'done').length;

    const failures24h = events.filter(
      (e) => new Date(e.created_at).getTime() >= dayAgo && /(fail|error|blocked|timeout)/i.test(e.message)
    ).length;

    const dueTasks = tasks
      .filter((t) => t.status !== 'done' && !!t.due_date)
      .map((t) => ({ ...t, dueTs: new Date(t.due_date as string).getTime() }))
      .filter((t) => !Number.isNaN(t.dueTs))
      .sort((a, b) => a.dueTs - b.dueTs);

    const nextDeadline = dueTasks[0] || null;
    const throughputToday = events.filter(
      (e) => new Date(e.created_at).getTime() >= dayAgo && e.type === 'task_completed'
    ).length;

    return {
      runningAgents,
      totalAgents: agents.length,
      blockedTasks,
      openTasks,
      failures24h,
      nextDeadline,
      throughputToday,
    };
  }, [tasks, events, agents]);

  const recentEvents = useMemo(
    () =>
      [...events]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 8),
    [events]
  );

  const modelStats = useMemo(() => {
    const usage = new Map<string, { count: number; names: string[] }>();

    for (const agent of agents) {
      const model = (agent.model || 'unassigned').trim();
      const prev = usage.get(model) || { count: 0, names: [] };
      usage.set(model, {
        count: prev.count + 1,
        names: [...prev.names, `${agent.avatar_emoji} ${agent.name}`],
      });
    }

    const rows = Array.from(usage.entries())
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const covered = agents.filter((a) => !!a.model).length;

    return {
      rows,
      covered,
      total: agents.length,
      unique: usage.size,
    };
  }, [agents]);

  const personalTracker = useMemo(() => {
    const todo = tasks.filter((t) => ['planning', 'inbox', 'assigned'].includes(t.status));
    const doing = tasks.filter((t) => ['in_progress', 'testing', 'review'].includes(t.status));
    const done = tasks.filter((t) => t.status === 'done');

    return {
      todo,
      doing,
      done,
    };
  }, [tasks]);

  const workflowStats = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const handoffs24h = events.filter((e) => {
      const ts = new Date(e.created_at).getTime();
      return ts >= dayAgo && (e.type === 'task_assigned' || /assigned to|dispatched to/i.test(e.message));
    }).length;

    const completion24h = events.filter((e) => {
      const ts = new Date(e.created_at).getTime();
      return ts >= dayAgo && e.type === 'task_completed';
    }).length;

    const pipeline = {
      queued: tasks.filter((t) => ['planning', 'inbox', 'assigned'].includes(t.status)).length,
      executing: tasks.filter((t) => ['in_progress', 'testing'].includes(t.status)).length,
      review: tasks.filter((t) => t.status === 'review').length,
      done: tasks.filter((t) => t.status === 'done').length,
    };

    return {
      handoffs24h,
      completion24h,
      pipeline,
    };
  }, [events, tasks]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('mc-widget-layout-v1');
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        metricOrder?: string[];
        opsOrder?: string[];
        intelOrder?: string[];
      };
      if (parsed.metricOrder?.length) setMetricOrder(parsed.metricOrder);
      if (parsed.opsOrder?.length) setOpsOrder(parsed.opsOrder);
      if (parsed.intelOrder?.length) setIntelOrder(parsed.intelOrder);
    } catch {
      // ignore bad saved layout
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      'mc-widget-layout-v1',
      JSON.stringify({ metricOrder, opsOrder, intelOrder })
    );
  }, [metricOrder, opsOrder, intelOrder]);

  const reorder = (list: string[], fromId: string, toId: string) => {
    const from = list.indexOf(fromId);
    const to = list.indexOf(toId);
    if (from === -1 || to === -1 || from === to) return list;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  const handleWidgetDrop = (targetId: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (!draggedWidget || draggedWidget === targetId) return;
    setter((prev) => reorder(prev, draggedWidget, targetId));
    setDraggedWidget(null);
  };

  const resetWidgetLayout = () => {
    const defaults = {
      metricOrder: ['running', 'blocked', 'failures', 'deadline', 'throughput'],
      opsOrder: ['needs_you', 'live_feed'],
      intelOrder: ['model_tracking', 'personal_tracker', 'workflow_visibility'],
    };

    setMetricOrder(defaults.metricOrder);
    setOpsOrder(defaults.opsOrder);
    setIntelOrder(defaults.intelOrder);
    localStorage.removeItem('mc-widget-layout-v1');
  };

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault();
    if (!draggedTask || draggedTask.status === targetStatus) {
      setDraggedTask(null);
      return;
    }

    updateTaskStatus(draggedTask.id, targetStatus);

    try {
      const res = await fetch(`/api/tasks/${draggedTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      });

      if (res.ok) {
        addEvent({
          id: crypto.randomUUID(),
          type: targetStatus === 'done' ? 'task_completed' : 'task_status_changed',
          task_id: draggedTask.id,
          message: `Task "${draggedTask.title}" moved to ${targetStatus}`,
          created_at: new Date().toISOString(),
        });

        if (shouldTriggerAutoDispatch(draggedTask.status, targetStatus, draggedTask.assigned_agent_id)) {
          const result = await triggerAutoDispatch({
            taskId: draggedTask.id,
            taskTitle: draggedTask.title,
            agentId: draggedTask.assigned_agent_id,
            agentName: draggedTask.assigned_agent?.name || 'Unknown Agent',
            workspaceId: draggedTask.workspace_id,
          });

          if (!result.success) {
            console.error('Auto-dispatch failed:', result.error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to update task status:', error);
      updateTaskStatus(draggedTask.id, draggedTask.status);
    }

    setDraggedTask(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-mc-border bg-mc-bg-secondary space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
            <span className="text-sm font-medium uppercase tracking-[0.2em] text-mc-text-secondary">Mission Queue</span>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-mc-accent text-mc-bg rounded-md text-sm font-medium hover:bg-mc-accent/90"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {metricOrder.map((id) => {
            const metricMap: Record<string, { tone: 'emerald' | 'amber' | 'rose' | 'blue' | 'violet'; value: string; label: string; hint: string }> = {
              running: { tone: 'emerald', value: `${metrics.runningAgents}/${metrics.totalAgents}`, label: 'Running now', hint: 'active agents' },
              blocked: { tone: 'amber', value: `${metrics.blockedTasks}`, label: 'Blocked tasks', hint: `${metrics.openTasks} open tasks` },
              failures: { tone: 'rose', value: `${metrics.failures24h}`, label: 'Failures (24h)', hint: 'errors, timeouts, blocked' },
              deadline: {
                tone: 'blue',
                value: metrics.nextDeadline ? formatDistanceToNow(new Date(metrics.nextDeadline.due_date as string), { addSuffix: true }) : 'none',
                label: 'Next deadline',
                hint: metrics.nextDeadline ? metrics.nextDeadline.title.slice(0, 26) : 'no due date set',
              },
              throughput: { tone: 'violet', value: `${metrics.throughputToday}`, label: 'Throughput (today)', hint: 'tasks completed' },
            };
            const m = metricMap[id];
            if (!m) return null;
            return (
              <div
                key={id}
                draggable
                onDragStart={() => setDraggedWidget(id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleWidgetDrop(id, setMetricOrder)}
              >
                <MetricCard tone={m.tone} value={m.value} label={m.label} hint={m.hint} />
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="px-3 py-1.5 rounded-md text-xs border border-mc-border bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-1">
            <Monitor className="w-3 h-3" /> Live mode
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetWidgetLayout}
              className="px-3 py-1.5 rounded-md border border-mc-border bg-mc-bg-secondary text-xs text-mc-text-secondary hover:text-mc-text hover:border-blue-500/40"
            >
              Reset layout
            </button>
            <div className="px-3 py-1.5 rounded-md border border-mc-border bg-mc-bg-secondary text-xs text-mc-text-secondary">All projects</div>
          </div>
        </div>
      </div>

      <div className="p-4 border-b border-mc-border bg-[#0a0f1a]/80">
        <OfficeCanvas />
      </div>

      <div className="p-3 border-b border-mc-border grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-3">
        {opsOrder.map((id) => (
          <div
            key={id}
            draggable
            onDragStart={() => setDraggedWidget(id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleWidgetDrop(id, setOpsOrder)}
          >
            {id === 'needs_you' ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
                  <AlertTriangle className="w-4 h-4" /> Needs You
                </div>
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded border border-mc-border/70 bg-mc-bg/70 px-2 py-1.5">
                    <span>Tasks waiting review</span>
                    <span className="text-amber-300 font-semibold">{tasks.filter((t) => t.status === 'review').length}</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-mc-border/70 bg-mc-bg/70 px-2 py-1.5">
                    <span>Tasks in testing</span>
                    <span className="text-blue-300 font-semibold">{tasks.filter((t) => t.status === 'testing').length}</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-mc-border/70 bg-mc-bg/70 px-2 py-1.5">
                    <span>Overdue tasks</span>
                    <span className="text-rose-300 font-semibold">{tasks.filter((t) => t.status !== 'done' && t.due_date && new Date(t.due_date).getTime() < Date.now()).length}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-mc-border bg-mc-bg-secondary/70 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Activity className="w-4 h-4 text-mc-accent" /> Live Activity Feed
                  </div>
                  <div className="text-xs text-mc-text-secondary">latest {recentEvents.length} events</div>
                </div>
                <div className="mt-3 grid gap-2">
                  {recentEvents.length === 0 ? (
                    <div className="text-xs text-mc-text-secondary">No activity yet.</div>
                  ) : (
                    recentEvents.map((event) => {
                      const isError = /(fail|error|blocked|timeout)/i.test(event.message);
                      const isSuccess = event.type === 'task_completed';
                      return (
                        <div key={event.id} className="rounded-lg border border-mc-border/60 bg-mc-bg/60 px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs text-mc-text leading-relaxed line-clamp-2">{event.message}</p>
                            <span className={`mt-0.5 inline-flex h-2 w-2 rounded-full ${isError ? 'bg-rose-400' : isSuccess ? 'bg-emerald-400' : 'bg-blue-400'}`} />
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-mc-text-secondary">
                            <Clock3 className="w-3 h-3" />
                            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                            {isSuccess && (
                              <span className="inline-flex items-center gap-1 text-emerald-300">
                                <CheckCircle2 className="w-3 h-3" />completed
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 border-b border-mc-border grid grid-cols-1 2xl:grid-cols-3 gap-3">
        {intelOrder.map((id) => (
          <div
            key={id}
            draggable
            onDragStart={() => setDraggedWidget(id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleWidgetDrop(id, setIntelOrder)}
          >
            {id === 'model_tracking' && (
              <div className="rounded-xl border border-mc-border bg-mc-bg-secondary/70 p-3">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 text-sm font-medium">
                    <BrainCircuit className="w-4 h-4 text-cyan-300" /> AI Model Tracking
                  </div>
                  <div className="text-[11px] text-mc-text-secondary">{modelStats.covered}/{modelStats.total} assigned</div>
                </div>
                <div className="mt-2 text-[11px] text-mc-text-secondary">{modelStats.unique} distinct models in this workspace</div>
                <div className="mt-3 space-y-2">
                  {modelStats.rows.length === 0 ? (
                    <div className="text-xs text-mc-text-secondary">No agents yet.</div>
                  ) : (
                    modelStats.rows.map((row) => (
                      <div key={row.model} className="rounded border border-mc-border/70 bg-mc-bg/70 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-mc-text truncate">{row.model}</div>
                          <span className="text-[11px] text-cyan-300 font-semibold">{row.count}</span>
                        </div>
                        <div className="text-[11px] text-mc-text-secondary mt-1 truncate">{row.names.join(', ')}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {id === 'personal_tracker' && (
              <div className="rounded-xl border border-mc-border bg-mc-bg-secondary/70 p-3">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 text-sm font-medium">
                    <ListTodo className="w-4 h-4 text-emerald-300" /> Personal Task Tracker
                  </div>
                  <div className="text-[11px] text-mc-text-secondary">To-Do / Doing / Done</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <TrackerPill label="To-Do" value={personalTracker.todo.length} tone="amber" />
                  <TrackerPill label="Doing" value={personalTracker.doing.length} tone="blue" />
                  <TrackerPill label="Done" value={personalTracker.done.length} tone="emerald" />
                </div>
                <div className="mt-3 text-[11px] text-mc-text-secondary space-y-1">
                  {personalTracker.doing.slice(0, 2).map((task) => (
                    <div key={task.id} className="truncate">• {task.title}</div>
                  ))}
                  {personalTracker.doing.length === 0 && <div>No active personal items right now.</div>}
                </div>
              </div>
            )}

            {id === 'workflow_visibility' && (
              <div className="rounded-xl border border-mc-border bg-mc-bg-secondary/70 p-3">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 text-sm font-medium">
                    <ArrowRightLeft className="w-4 h-4 text-violet-300" /> Agentic Workflow Visibility
                  </div>
                  <div className="text-[11px] text-mc-text-secondary">last 24h</div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-mc-border/70 bg-mc-bg/70 px-2 py-1.5">
                    <div className="text-mc-text-secondary">Handoffs</div>
                    <div className="text-violet-300 text-lg font-semibold">{workflowStats.handoffs24h}</div>
                  </div>
                  <div className="rounded border border-mc-border/70 bg-mc-bg/70 px-2 py-1.5">
                    <div className="text-mc-text-secondary">Completed</div>
                    <div className="text-emerald-300 text-lg font-semibold">{workflowStats.completion24h}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1 text-[11px]">
                  <PipelineNode label="Queue" value={workflowStats.pipeline.queued} />
                  <PipelineNode label="Exec" value={workflowStats.pipeline.executing} />
                  <PipelineNode label="Review" value={workflowStats.pipeline.review} />
                  <PipelineNode label="Done" value={workflowStats.pipeline.done} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex-1 flex gap-3 p-3 overflow-x-auto bg-mc-bg">
        {COLUMNS.map((column) => {
          const columnTasks = getTasksByStatus(column.id);
          return (
            <div
              key={column.id}
              className={`flex-1 min-w-[240px] max-w-[330px] flex flex-col bg-mc-bg-secondary rounded-lg border border-mc-border border-t-2 ${column.color}`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              <div className="p-2 border-b border-mc-border flex items-center justify-between">
                <span className="text-xs font-medium text-mc-text-secondary inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-mc-accent" />
                  {column.label}
                </span>
                <span className="text-xs bg-mc-bg-tertiary px-2 py-0.5 rounded text-mc-text-secondary">{columnTasks.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onDragStart={handleDragStart}
                    onClick={() => setEditingTask(task)}
                    isDragging={draggedTask?.id === task.id}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {showCreateModal && <TaskModal onClose={() => setShowCreateModal(false)} workspaceId={workspaceId} />}
      {editingTask && <TaskModal task={editingTask} onClose={() => setEditingTask(null)} workspaceId={workspaceId} />}
    </div>
  );
}

interface MetricCardProps {
  value: string;
  label: string;
  hint: string;
  tone: 'emerald' | 'amber' | 'rose' | 'blue' | 'violet';
}

function MetricCard({ value, label, hint, tone }: MetricCardProps) {
  const toneClass = {
    emerald: 'text-emerald-300',
    amber: 'text-amber-300',
    rose: 'text-rose-300',
    blue: 'text-blue-300',
    violet: 'text-violet-300',
  };

  return (
    <div className="rounded-md border border-mc-border bg-mc-bg p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className={`text-lg md:text-2xl font-semibold leading-none ${toneClass[tone]}`}>{value}</div>
      <div className="text-xs text-mc-text mt-1">{label}</div>
      <div className="text-[11px] text-mc-text-secondary mt-1 line-clamp-1">{hint}</div>
    </div>
  );
}

function TrackerPill({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'blue' | 'emerald' }) {
  const toneClass = {
    amber: 'text-amber-300 border-amber-400/30 bg-amber-500/10',
    blue: 'text-blue-300 border-blue-400/30 bg-blue-500/10',
    emerald: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  };

  return (
    <div className={`rounded border px-2 py-2 ${toneClass[tone]}`}>
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wide mt-1">{label}</div>
    </div>
  );
}

function PipelineNode({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-mc-border/70 bg-mc-bg/70 px-2 py-1.5 text-center">
      <div className="text-[10px] text-mc-text-secondary uppercase">{label}</div>
      <div className="text-sm font-semibold text-mc-text mt-0.5">{value}</div>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onClick: () => void;
  isDragging: boolean;
}

function TaskCard({ task, onDragStart, onClick, isDragging }: TaskCardProps) {
  const priorityStyles = {
    low: 'text-mc-text-secondary',
    normal: 'text-mc-accent',
    high: 'text-mc-accent-yellow',
    urgent: 'text-mc-accent-red',
  };

  const priorityDots = {
    low: 'bg-mc-text-secondary/40',
    normal: 'bg-mc-accent',
    high: 'bg-mc-accent-yellow',
    urgent: 'bg-mc-accent-red',
  };

  const isPlanning = task.status === 'planning';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onClick={onClick}
      className={`group bg-mc-bg border rounded-lg cursor-pointer transition-colors hover:bg-mc-bg-tertiary ${
        isDragging ? 'opacity-50 scale-95' : ''
      } ${isPlanning ? 'border-purple-500/40 hover:border-purple-500' : 'border-mc-border/50 hover:border-mc-accent/40'}`}
    >
      <div className="flex items-center justify-center py-1.5 border-b border-mc-border/30 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-4 h-4 text-mc-text-secondary/50 cursor-grab" />
      </div>

      <div className="p-4">
        <h4 className="text-sm font-medium leading-snug line-clamp-2 mb-3">{task.title}</h4>

        {isPlanning && (
          <div className="flex items-center gap-2 mb-3 py-2 px-3 bg-purple-500/10 rounded-md border border-purple-500/20">
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs text-purple-400 font-medium">Continue planning</span>
          </div>
        )}

        {task.assigned_agent && (
          <div className="flex items-center gap-2 mb-3 py-1.5 px-2 bg-mc-bg-tertiary/50 rounded">
            <span className="text-base">{(task.assigned_agent as unknown as { avatar_emoji: string }).avatar_emoji}</span>
            <span className="text-xs text-mc-text-secondary truncate">{(task.assigned_agent as unknown as { name: string }).name}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-mc-border/20">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${priorityDots[task.priority]}`} />
            <span className={`text-xs capitalize ${priorityStyles[task.priority]}`}>{task.priority}</span>
          </div>
          <span className="text-[10px] text-mc-text-secondary/60">
            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
}
