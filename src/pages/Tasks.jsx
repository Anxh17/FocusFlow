import { useState, useCallback, useEffect } from 'react';
import { Plus, ListTodo, X, AlertCircle, Clock, Pause, Play, Square } from 'lucide-react';
import {
  getTasks, addTask, updateTask, completeTask,
  reopenTask, postponeTask, deleteTask
} from '../services/taskService.js';
import { getMilestones } from '../services/milestoneService.js';
import {
  getActiveTimer, startTimer, pauseTimer, resumeTimer,
  stopTimer, getActiveTimerElapsedSeconds
} from '../services/timerService.js';
import { isTaskBlocked, getBlockingPrerequisites } from '../utils/schedulingUtils.js';
import { validateTaskForm } from '../utils/validation.js';
import { getTodayStr, formatDisplayDate, formatTimerSeconds } from '../utils/dateUtils.js';
import Header from '../components/Header.jsx';
import TaskCard from '../components/TaskCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import DependencySelector from '../components/DependencySelector.jsx';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export default function Tasks() {
  const [tasks, setTasks] = useState(() => getTasks());
  const [milestones] = useState(() => getMilestones());
  const [activeTimer, setActiveTimer] = useState(() => getActiveTimer());
  const [, setTimerTick] = useState(0);
  const bannerElapsed = activeTimer ? getActiveTimerElapsedSeconds(activeTimer) : 0;

  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [actionError, setActionError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [showPostpone, setShowPostpone] = useState(null);
  const [showDelete, setShowDelete] = useState(null);
  const [switchConfirmTask, setSwitchConfirmTask] = useState(null);
  const [postponeDate, setPostponeDate] = useState('');

  const [form, setForm] = useState({
    title: '',
    description: '',
    date: getTodayStr(),
    estimatedMinutes: '30',
    priority: 'medium',
    milestoneId: '',
    dependencies: [],
  });
  const [formErrors, setFormErrors] = useState({});

  const refresh = useCallback(() => {
    setTasks(getTasks());
    setActiveTimer(getActiveTimer());
  }, []);

  useEffect(() => {
    if (!activeTimer || activeTimer.status !== 'running') return;
    const id = setInterval(() => {
      setTimerTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  function resetForm() {
    setForm({
      title: '',
      description: '',
      date: getTodayStr(),
      estimatedMinutes: '30',
      priority: 'medium',
      milestoneId: '',
      dependencies: [],
    });
    setFormErrors({});
    setEditingTask(null);
    setShowForm(false);
  }

  function handleOpenEdit(task) {
    setForm({
      title: task.title,
      description: task.description || '',
      date: task.date,
      estimatedMinutes: String(task.estimatedMinutes),
      priority: task.priority,
      milestoneId: task.milestoneId || '',
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    });
    setFormErrors({});
    setEditingTask(task);
    setShowForm(true);
  }

  function handleSubmitForm() {
    const errors = validateTaskForm(form);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const data = {
      title: form.title.trim(),
      description: form.description.trim(),
      date: form.date,
      estimatedMinutes: parseInt(form.estimatedMinutes, 10),
      priority: form.priority,
      milestoneId: form.milestoneId || null,
      dependencies: form.dependencies,
    };

    try {
      if (editingTask) {
        updateTask(editingTask.id, data);
      } else {
        addTask(data);
      }
      resetForm();
      refresh();
    } catch (err) {
      setFormErrors({ dependencies: err.message });
    }
  }

  function handleToggle(task) {
    setActionError('');
    try {
      if (task.status === 'completed') {
        reopenTask(task.id);
      } else {
        completeTask(task.id);
      }
      refresh();
    } catch (err) {
      setActionError(err.message);
    }
  }

  function handleStartTimer(task) {
    setActionError('');
    const result = startTimer(task.id);
    if (result.conflict) {
      setSwitchConfirmTask(task);
      return;
    }
    refresh();
  }

  function handleConfirmSwitchTimer() {
    if (!switchConfirmTask) return;
    startTimer(switchConfirmTask.id, { forceSwitch: true });
    setSwitchConfirmTask(null);
    refresh();
  }

  function handlePauseTimer() {
    pauseTimer();
    refresh();
  }

  function handleResumeTimer() {
    resumeTimer();
    refresh();
  }

  function handleStopTimer() {
    stopTimer();
    refresh();
  }

  function handlePostpone() {
    if (!showPostpone || !postponeDate) return;
    postponeTask(showPostpone.id, postponeDate);
    setShowPostpone(null);
    setPostponeDate('');
    refresh();
  }

  function handleDelete() {
    if (!showDelete) return;
    deleteTask(showDelete.id);
    setShowDelete(null);
    refresh();
  }

  const today = getTodayStr();
  let filtered = tasks;
  if (filter === 'today') filtered = tasks.filter((t) => t.date === today);
  else if (filter === 'upcoming') filtered = tasks.filter((t) => t.status === 'pending' && t.date > today);
  else if (filter === 'overdue') filtered = tasks.filter((t) => t.status === 'pending' && t.date < today);
  else if (filter === 'completed') filtered = tasks.filter((t) => t.status === 'completed');
  else if (filter === 'blocked') filtered = tasks.filter((t) => isTaskBlocked(t, tasks));

  function sortTaskList(list) {
    return [...list].sort((a, b) => {
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (a.status !== 'completed' && b.status === 'completed') return -1;
      if (sortBy === 'priority') {
        return (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
      }
      if (sortBy === 'duration') {
        return (b.estimatedMinutes || 0) - (a.estimatedMinutes || 0);
      }
      const dDiff = (a.date || '').localeCompare(b.date || '');
      if (dDiff !== 0) return dDiff;
      return (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    });
  }

  const grouped = {};
  filtered.forEach((t) => {
    const key = t.date || 'unscheduled';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  });
  const sortedDates = Object.keys(grouped).sort();
  const activeTimerTask = activeTimer ? tasks.find((t) => t.id === activeTimer.taskId) : null;

  return (
    <>
      <Header
        title="Tasks"
        subtitle={`${tasks.length} total · ${tasks.filter((t) => t.status === 'completed').length} completed`}
        action={
          <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }} type="button">
            <Plus size={16} /> Add Task
          </button>
        }
      />
      <div className="page-body">
        {/* Active Timer Banner */}
        {activeTimer && activeTimerTask && (
          <div className="active-timer-banner" role="region" aria-label="Active task timer">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Clock size={18} color="var(--accent-secondary)" />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
                  {activeTimerTask.title}
                </div>
                <div className="text-sm text-muted">
                  {activeTimer.status === 'paused' ? 'Timer paused' : 'Timer running'} · {formatTimerSeconds(bannerElapsed)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {activeTimer.status === 'running' ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={handlePauseTimer}>
                  <Pause size={14} /> Pause
                </button>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleResumeTimer}>
                  <Play size={14} /> Resume
                </button>
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={handleStopTimer}>
                <Square size={14} /> Stop &amp; Save
              </button>
            </div>
          </div>
        )}

        {actionError && (
          <div className="error-banner" role="alert">
            <AlertCircle size={16} />
            <span>{actionError}</span>
            <button type="button" className="btn-icon" onClick={() => setActionError('')} aria-label="Dismiss error">
              <X size={14} />
            </button>
          </div>
        )}

        <div className="task-toolbar">
          <div className="task-filters" role="tablist" aria-label="Filter tasks">
            {[
              { key: 'all', label: 'All' },
              { key: 'today', label: 'Today' },
              { key: 'upcoming', label: 'Upcoming' },
              { key: 'overdue', label: 'Overdue' },
              { key: 'completed', label: 'Completed' },
              { key: 'blocked', label: 'Blocked' },
            ].map((f) => (
              <button
                key={f.key}
                className={`filter-btn${filter === f.key ? ' active' : ''}`}
                onClick={() => setFilter(f.key)}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="sort-control">
            <label htmlFor="task-sort" className="text-sm text-muted" style={{ marginBottom: 0 }}>Sort:</label>
            <select
              id="task-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ width: 'auto', minHeight: 36, padding: '6px 12px', fontSize: '0.8125rem' }}
            >
              <option value="date">Date</option>
              <option value="priority">Priority</option>
              <option value="duration">Estimated Duration</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={filter === 'all' ? 'No tasks yet' : `No ${filter} tasks`}
            message={filter === 'all' ? 'Add your first task to get started.' : 'No tasks match this filter right now.'}
            action={
              filter === 'all' ? (
                <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }} type="button">
                  <Plus size={14} /> Add Task
                </button>
              ) : null
            }
          />
        ) : (
          sortedDates.map((date) => (
            <div key={date} style={{ marginBottom: 24 }}>
              <div className="section-header">
                <div className="section-title">
                  {date === today ? 'Today' : formatDisplayDate(date)}
                  {date < today && grouped[date].some((t) => t.status === 'pending') && (
                    <span className="badge badge-high">Overdue</span>
                  )}
                </div>
                <div className="section-count">
                  {grouped[date].length} {grouped[date].length === 1 ? 'task' : 'tasks'}
                </div>
              </div>
              <div className="task-list">
                {sortTaskList(grouped[date]).map((task) => {
                  const blocked = isTaskBlocked(task, tasks);
                  const blockingNames = blocked
                    ? getBlockingPrerequisites(task, tasks).map((p) => p.title)
                    : [];
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      allTasks={tasks}
                      milestones={milestones}
                      activeTimer={activeTimer}
                      blocked={blocked}
                      blockingNames={blockingNames}
                      onToggle={handleToggle}
                      onEdit={handleOpenEdit}
                      onDelete={(t) => setShowDelete(t)}
                      onPostpone={(t) => { setShowPostpone(t); setPostponeDate(today); }}
                      onStartTimer={handleStartTimer}
                      onPauseTimer={handlePauseTimer}
                      onResumeTimer={handleResumeTimer}
                      onStopTimer={handleStopTimer}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}

        {/* Add/Edit Task Modal */}
        {showForm && (
          <div className="modal-overlay" onClick={resetForm} role="dialog" aria-modal="true" aria-label={editingTask ? 'Edit Task' : 'Add Task'}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{editingTask ? 'Edit Task' : 'Add Task'}</h2>
                <button className="btn-icon" onClick={resetForm} aria-label="Close" type="button">
                  <X size={18} />
                </button>
              </div>

              <div className="form-group">
                <label htmlFor="task-title">Title</label>
                <input
                  id="task-title"
                  type="text"
                  placeholder="What do you need to do?"
                  value={form.title}
                  onChange={(e) => { setForm((p) => ({ ...p, title: e.target.value })); setFormErrors((p) => ({ ...p, title: undefined })); }}
                  autoFocus
                />
                {formErrors.title && <div className="form-error" role="alert">{formErrors.title}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="task-desc">Description (Optional)</label>
                <textarea
                  id="task-desc"
                  placeholder="Add details..."
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="task-date">Date</label>
                  <input
                    id="task-date"
                    type="date"
                    value={form.date}
                    onChange={(e) => { setForm((p) => ({ ...p, date: e.target.value })); setFormErrors((p) => ({ ...p, date: undefined })); }}
                  />
                  {formErrors.date && <div className="form-error" role="alert">{formErrors.date}</div>}
                </div>
                <div className="form-group">
                  <label htmlFor="task-duration">Duration (minutes)</label>
                  <input
                    id="task-duration"
                    type="number"
                    min="1"
                    max="480"
                    value={form.estimatedMinutes}
                    onChange={(e) => { setForm((p) => ({ ...p, estimatedMinutes: e.target.value })); setFormErrors((p) => ({ ...p, estimatedMinutes: undefined })); }}
                  />
                  {formErrors.estimatedMinutes && <div className="form-error" role="alert">{formErrors.estimatedMinutes}</div>}
                </div>
              </div>

              <div className="form-group">
                <label>Priority</label>
                <div className="skill-options" role="group" aria-label="Task Priority">
                  {['high', 'medium', 'low'].map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`skill-option${form.priority === p ? ' selected' : ''}`}
                      onClick={() => setForm((prev) => ({ ...prev, priority: p }))}
                      aria-pressed={form.priority === p}
                    >
                      <div className="skill-label" style={{ textTransform: 'capitalize' }}>{p}</div>
                    </button>
                  ))}
                </div>
              </div>

              {milestones.length > 0 && (
                <div className="form-group">
                  <label htmlFor="task-milestone">Milestone (Optional)</label>
                  <select
                    id="task-milestone"
                    value={form.milestoneId}
                    onChange={(e) => setForm((p) => ({ ...p, milestoneId: e.target.value }))}
                  >
                    <option value="">None</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>Prerequisites / Dependencies</label>
                <DependencySelector
                  currentTaskId={editingTask?.id || null}
                  allTasks={tasks}
                  selectedIds={form.dependencies}
                  onChange={(deps) => { setForm((p) => ({ ...p, dependencies: deps })); setFormErrors((p) => ({ ...p, dependencies: undefined })); }}
                />
                {formErrors.dependencies && <div className="form-error" role="alert">{formErrors.dependencies}</div>}
              </div>

              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={resetForm} type="button">Cancel</button>
                <button className="btn btn-primary" onClick={handleSubmitForm} type="button">
                  {editingTask ? 'Save Changes' : 'Add Task'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Switch Timer Confirmation Modal */}
        {switchConfirmTask && (
          <div className="modal-overlay" onClick={() => setSwitchConfirmTask(null)} role="dialog" aria-modal="true" aria-label="Switch Active Timer">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Timer Already Active</h2>
                <button className="btn-icon" onClick={() => setSwitchConfirmTask(null)} aria-label="Close" type="button">
                  <X size={18} />
                </button>
              </div>
              <p className="text-muted" style={{ marginBottom: 16 }}>
                Another task timer is currently active. Do you want to stop and save the current session, then start timing &quot;{switchConfirmTask.title}&quot;?
              </p>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setSwitchConfirmTask(null)} type="button">Keep Current</button>
                <button className="btn btn-primary" onClick={handleConfirmSwitchTimer} type="button">
                  Stop Current &amp; Switch
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Postpone Modal */}
        {showPostpone && (
          <div className="modal-overlay" onClick={() => setShowPostpone(null)} role="dialog" aria-modal="true" aria-label="Postpone Task">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Postpone Task</h2>
                <button className="btn-icon" onClick={() => setShowPostpone(null)} aria-label="Close" type="button">
                  <X size={18} />
                </button>
              </div>
              <p className="text-muted" style={{ marginBottom: 16 }}>
                Move &quot;{showPostpone.title}&quot; to a new date. This will be recorded in the task&apos;s postponement history.
              </p>
              <div className="form-group">
                <label htmlFor="postpone-date">New Date</label>
                <input
                  id="postpone-date"
                  type="date"
                  min={today}
                  value={postponeDate}
                  onChange={(e) => setPostponeDate(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowPostpone(null)} type="button">Cancel</button>
                <button className="btn btn-primary" onClick={handlePostpone} disabled={!postponeDate} type="button">
                  Postpone
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDelete && (
          <div className="modal-overlay" onClick={() => setShowDelete(null)} role="dialog" aria-modal="true" aria-label="Delete Task">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="confirm-dialog">
                <h2>Delete Task</h2>
                <p>
                  Are you sure you want to delete &quot;{showDelete.title}&quot;? This action cannot be undone.
                </p>
                <div className="modal-actions" style={{ justifyContent: 'center' }}>
                  <button className="btn btn-secondary" onClick={() => setShowDelete(null)} type="button">Cancel</button>
                  <button className="btn btn-danger" onClick={handleDelete} type="button">Delete</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
