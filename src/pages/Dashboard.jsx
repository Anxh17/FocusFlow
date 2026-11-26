import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Target, Calendar, Clock, CheckCircle2,
  TrendingUp, Sparkles, X, ArrowRight, Edit3, Play,
  AlertCircle, Flag, RefreshCw, Plus, Pause, Square, AlertTriangle, History, RotateCcw
} from 'lucide-react';
import { getGoal, updateGoal } from '../services/goalService.js';
import { getTasks, completeTask, reopenTask } from '../services/taskService.js';
import {
  getMilestones, getMilestoneProgress, addMilestone,
  updateMilestone, toggleMilestoneStatus
} from '../services/milestoneService.js';
import {
  distributeTasks, applyReplan, getNextRecommendedTask
} from '../services/planningService.js';
import {
  getActiveTimer, pauseTimer, resumeTimer, stopTimer,
  getActiveTimerElapsedSeconds
} from '../services/timerService.js';
import { isTaskBlocked, getBlockingPrerequisites } from '../utils/schedulingUtils.js';
import { validateGoalForm } from '../utils/validation.js';
import { GOAL_CATEGORIES, SKILL_LEVELS } from '../data/demoData.js';
import {
  getTodayStr, getGreeting, formatDisplayDate,
  daysUntil, formatDuration, formatSecondsCompact, formatTimerSeconds
} from '../utils/dateUtils.js';
import Header from '../components/Header.jsx';
import TaskCard from '../components/TaskCard.jsx';
import ProgressCard from '../components/ProgressCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import MilestoneCard from '../components/MilestoneCard.jsx';
import SchedulePreview from '../components/SchedulePreview.jsx';
import RecoveryWizard from '../components/RecoveryWizard.jsx';
import RecoveryHistory from '../components/RecoveryHistory.jsx';
import { getRecoveryHistory } from '../services/recoveryService.js';
import {
  isDemoMode, loadDemoWorkspace, resetDemoWorkspace, exitDemoWorkspace
} from '../services/demoService.js';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export default function Dashboard() {
  const navigate = useNavigate();
  const [goal, setGoal] = useState(() => getGoal());
  const [tasks, setTasks] = useState(() => getTasks());
  const [milestones, setMilestones] = useState(() => getMilestones());
  const [recoveryHistory, setRecoveryHistory] = useState(() => getRecoveryHistory());
  const [activeTimer, setActiveTimer] = useState(() => getActiveTimer());
  const [, setTimerTick] = useState(0);
  const timerElapsed = activeTimer ? getActiveTimerElapsedSeconds(activeTimer) : 0;

  const [actionError, setActionError] = useState('');
  const [showRecover, setShowRecover] = useState(false);
  const [showEditGoal, setShowEditGoal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editErrors, setEditErrors] = useState({});
  const [schedulePreview, setSchedulePreview] = useState(null);

  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState(null);
  const [milestoneForm, setMilestoneForm] = useState({ title: '', description: '', targetDate: '' });
  const [milestoneError, setMilestoneError] = useState('');

  const today = getTodayStr();

  const refreshAll = useCallback(() => {
    setGoal(getGoal());
    setTasks(getTasks());
    setMilestones(getMilestones());
    setRecoveryHistory(getRecoveryHistory());
    setActiveTimer(getActiveTimer());
  }, []);

  useEffect(() => {
    if (!activeTimer || activeTimer.status !== 'running') return;
    const id = setInterval(() => {
      setTimerTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  if (!goal) {
    return (
      <>
        <Header title="Dashboard" />
        <div className="page-body">
          <EmptyState
            icon={Target}
            title="No goal set yet"
            message="Set up your primary goal to generate a daily execution plan, or explore FocusFlow with realistic sample data."
            action={
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={() => navigate('/onboarding')} type="button">
                  Set Up My Goal <ArrowRight size={16} />
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    loadDemoWorkspace();
                    refreshAll();
                  }}
                  type="button"
                >
                  <Sparkles size={15} /> Load Interactive Demo
                </button>
              </div>
            }
          />
        </div>
      </>
    );
  }

  const todayTasks = tasks.filter((t) => t.date === today);
  const todayCompleted = todayTasks.filter((t) => t.status === 'completed').length;
  const totalCompleted = tasks.filter((t) => t.status === 'completed').length;
  const totalPlannedMinutes = tasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
  const totalActualSeconds = tasks.reduce((sum, t) => sum + (t.actualSeconds || 0), 0);
  const blockedCount = tasks.filter((t) => isTaskBlocked(t, tasks)).length;
  const postponedCount = tasks.filter((t) => (t.postponementCount || 0) > 0).length;
  const completedMilestones = milestones.filter((m) => m.status === 'completed').length;
  const daysLeft = daysUntil(goal.deadline);

  const sortedTodayTasks = [...todayTasks].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (a.status !== 'completed' && b.status === 'completed') return -1;
    return (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
  });

  const recommendation = getNextRecommendedTask(tasks, today);
  const activeTimerTask = activeTimer ? tasks.find((t) => t.id === activeTimer.taskId) : null;
  const upcomingMilestones = milestones
    .filter((m) => m.status !== 'completed')
    .sort((a, b) => (a.targetDate || '').localeCompare(b.targetDate || ''))
    .slice(0, 2);

  function handleToggle(task) {
    setActionError('');
    try {
      if (task.status === 'completed') {
        reopenTask(task.id);
      } else {
        completeTask(task.id);
      }
      refreshAll();
    } catch (err) {
      setActionError(err.message);
    }
  }

  function openEditGoalModal() {
    setEditForm({
      title: goal.title || '',
      category: goal.category || '',
      deadline: goal.deadline || '',
      availableHoursPerDay: String(goal.availableHoursPerDay || ''),
      skillLevel: goal.skillLevel || 'intermediate',
      description: goal.description || '',
    });
    setEditErrors({});
    setShowEditGoal(true);
  }

  function handleSaveGoalEdit() {
    const errors = validateGoalForm(editForm);
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }
    updateGoal({
      title: editForm.title.trim(),
      category: editForm.category,
      deadline: editForm.deadline,
      availableHoursPerDay: parseFloat(editForm.availableHoursPerDay),
      skillLevel: editForm.skillLevel,
      description: editForm.description.trim(),
    });
    refreshAll();
    setShowEditGoal(false);
  }

  function handlePreviewReplan() {
    const preview = distributeTasks(tasks, goal, { startDate: today });
    setSchedulePreview(preview);
  }

  function handleApplyReplan(scheduledTasks) {
    applyReplan(scheduledTasks);
    setSchedulePreview(null);
    refreshAll();
  }

  function openAddMilestone() {
    setEditingMilestone(null);
    setMilestoneForm({ title: '', description: '', targetDate: goal.deadline });
    setMilestoneError('');
    setShowMilestoneModal(true);
  }

  function openEditMilestone(m) {
    setEditingMilestone(m);
    setMilestoneForm({ title: m.title, description: m.description || '', targetDate: m.targetDate || goal.deadline });
    setMilestoneError('');
    setShowMilestoneModal(true);
  }

  function handleSaveMilestone() {
    if (!milestoneForm.title.trim()) {
      setMilestoneError('Milestone title is required.');
      return;
    }
    if (editingMilestone) {
      updateMilestone(editingMilestone.id, {
        title: milestoneForm.title.trim(),
        description: milestoneForm.description.trim(),
        targetDate: milestoneForm.targetDate,
      });
    } else {
      addMilestone(milestoneForm);
    }
    setShowMilestoneModal(false);
    refreshAll();
  }

  const scheduleAffectingChanged = editForm && (
    editForm.deadline !== goal.deadline ||
    parseFloat(editForm.availableHoursPerDay) !== goal.availableHoursPerDay ||
    editForm.category !== goal.category ||
    editForm.skillLevel !== goal.skillLevel
  );

  return (
    <>
      <Header
        title={getGreeting()}
        subtitle={formatDisplayDate(today)}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={handlePreviewReplan} type="button">
              <RefreshCw size={15} /> Replan Schedule
            </button>
            <button className="btn btn-secondary btn-sm" onClick={openEditGoalModal} type="button">
              <Edit3 size={15} /> Edit Goal
            </button>
          </div>
        }
      />
      <div className="page-body">
        {isDemoMode() && (
          <div className="demo-banner" role="region" aria-label="Sample Demo Workspace">
            <div>
              <strong>Sample Demo Workspace</strong>
              <span className="text-sm text-muted" style={{ marginLeft: 8 }}>
                Exploring sample data. Your own goals are never overwritten.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  resetDemoWorkspace();
                  refreshAll();
                }}
              >
                <RotateCcw size={14} /> Reset Demo
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  exitDemoWorkspace();
                  navigate('/onboarding');
                }}
              >
                Exit Demo &amp; Set My Goal
              </button>
            </div>
          </div>
        )}

        {/* Active Timer Banner */}
        {activeTimer && activeTimerTask && (
          <div className="active-timer-banner" role="region" aria-label="Active task timer">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Clock size={18} color="var(--accent-secondary)" />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{activeTimerTask.title}</div>
                <div className="text-sm text-muted">
                  {activeTimer.status === 'paused' ? 'Paused' : 'Running'} · {formatTimerSeconds(timerElapsed)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {activeTimer.status === 'running' ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { pauseTimer(); refreshAll(); }}>
                  <Pause size={14} /> Pause
                </button>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { resumeTimer(); refreshAll(); }}>
                  <Play size={14} /> Resume
                </button>
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { stopTimer(); refreshAll(); }}>
                <Square size={14} /> Stop
              </button>
            </div>
          </div>
        )}

        {actionError && (
          <div className="error-banner" role="alert">
            <AlertCircle size={16} />
            <span>{actionError}</span>
            <button type="button" className="btn-icon" onClick={() => setActionError('')} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}

        {/* 1. Main Goal Banner */}
        <div className="goal-banner">
          <div className="goal-banner-info">
            <h2>{goal.title}</h2>
            {goal.description && (
              <p className="text-sm text-muted" style={{ marginBottom: 8 }}>{goal.description}</p>
            )}
            <div className="goal-banner-meta">
              <span><Target /> {goal.category}</span>
              <span><Calendar /> {formatDisplayDate(goal.deadline)}</span>
              <span>
                <Clock />
                {daysLeft > 0 ? `${daysLeft} days left` : daysLeft === 0 ? 'Due today' : 'Past deadline'}
              </span>
              {upcomingMilestones.length > 0 && (
                <span>
                  <Flag /> Next milestone: {upcomingMilestones[0].title} ({formatDisplayDate(upcomingMilestones[0].targetDate)})
                </span>
              )}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowRecover(true)} type="button">
            <Sparkles />
            Recover My Day
          </button>
        </div>

        {/* 3. Progress & Execution Summary */}
        <div className="stats-grid">
          <ProgressCard
            label="Today's Progress"
            value={todayCompleted}
            total={todayTasks.length}
            color="var(--accent-primary)"
          />
          <ProgressCard
            label="Overall Tasks"
            value={totalCompleted}
            total={tasks.length}
            color="var(--accent-secondary)"
          />
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--color-success-muted)' }}>
              <TrendingUp color="var(--color-success)" />
            </div>
            <div className="stat-label">Estimated vs Actual</div>
            <div className="stat-value">{formatSecondsCompact(totalActualSeconds)}</div>
            <div className="text-sm text-muted">{formatDuration(totalPlannedMinutes)} estimated</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--accent-primary-muted)' }}>
              <Flag color="var(--accent-primary)" />
            </div>
            <div className="stat-label">Milestones &amp; Health</div>
            <div className="stat-value">
              {completedMilestones}/{milestones.length}
            </div>
            <div className="text-sm text-muted">
              {blockedCount} blocked · {postponedCount} postponed
            </div>
          </div>
        </div>

        {/* 4. Next Recommended Task */}
        {recommendation && (
          <div className="next-up-card">
            <div>
              <div className="text-sm" style={{ color: 'var(--accent-primary)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Play size={14} /> Next Recommended Task (Rule-Based)
              </div>
              <div style={{ fontWeight: 600, fontSize: '1rem' }}>{recommendation.task.title}</div>
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                {recommendation.reason}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => handleToggle(recommendation.task)} type="button">
              <CheckCircle2 size={15} /> Mark Complete
            </button>
          </div>
        )}

        {/* 2. Today's Tasks */}
        <div style={{ marginBottom: 32 }}>
          <div className="section-header">
            <h3 className="section-title">Today&apos;s Tasks ({todayTasks.length})</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/tasks')} type="button">
              Manage All <ArrowRight size={14} />
            </button>
          </div>

          {sortedTodayTasks.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No tasks scheduled for today"
              message="Add a task for today or view your upcoming schedule on the Tasks page."
              action={
                <button className="btn btn-primary btn-sm" onClick={() => navigate('/tasks')} type="button">
                  Go to Tasks
                </button>
              }
            />
          ) : (
            <div className="task-list">
              {sortedTodayTasks.map((task) => {
                const blocked = isTaskBlocked(task, tasks);
                const blockingNames = blocked
                  ? getBlockingPrerequisites(task, tasks).map((p) => p.title)
                  : [];
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    blocked={blocked}
                    blockingNames={blockingNames}
                    onToggle={handleToggle}
                    compact
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Milestones Section */}
        <div style={{ marginBottom: 32 }}>
          <div className="section-header">
            <h3 className="section-title">
              <Flag size={16} color="var(--accent-primary)" /> Milestones ({completedMilestones}/{milestones.length})
            </h3>
            <button className="btn btn-secondary btn-sm" onClick={openAddMilestone} type="button">
              <Plus size={14} /> Add Milestone
            </button>
          </div>

          {milestones.length === 0 ? (
            <EmptyState
              icon={Flag}
              title="No milestones yet"
              message="Add milestones to break your goal into trackable phases."
              action={
                <button className="btn btn-primary btn-sm" onClick={openAddMilestone} type="button">
                  <Plus size={14} /> Add Milestone
                </button>
              }
            />
          ) : (
            <div className="milestones-grid">
              {milestones.map((m) => (
                <MilestoneCard
                  key={m.id}
                  milestone={m}
                  progress={getMilestoneProgress(m.id, tasks)}
                  onToggle={(item) => { toggleMilestoneStatus(item.id); refreshAll(); }}
                  onEdit={openEditMilestone}
                />
              ))}
            </div>
          )}
        </div>

        {/* Recovery History Section */}
        <div>
          <div className="section-header">
            <h3 className="section-title">
              <History size={16} color="var(--accent-primary)" /> Recovery History ({recoveryHistory.length})
            </h3>
          </div>
          <RecoveryHistory records={recoveryHistory.slice(0, 5)} />
        </div>

        {/* Schedule Preview Modal */}
        <SchedulePreview
          preview={schedulePreview}
          onConfirm={handleApplyReplan}
          onClose={() => setSchedulePreview(null)}
        />

        {/* Stage 3 AI Schedule Recovery Wizard */}
        <RecoveryWizard
          isOpen={showRecover}
          goal={goal}
          tasks={tasks}
          milestones={milestones}
          onApplied={refreshAll}
          onClose={() => { setShowRecover(false); refreshAll(); }}
        />

        {/* Edit Goal Modal */}
        {showEditGoal && editForm && (
          <div className="modal-overlay" onClick={() => setShowEditGoal(false)} role="dialog" aria-modal="true" aria-label="Edit Goal">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Edit Goal Details</h2>
                <button className="btn-icon" onClick={() => setShowEditGoal(false)} aria-label="Close" type="button">
                  <X size={18} />
                </button>
              </div>

              {scheduleAffectingChanged && (
                <div className="sample-data-notice" style={{ marginBottom: 16 }}>
                  <AlertTriangle />
                  <span>
                    Changing deadline or daily hours affects capacity. Existing tasks will not be overwritten automatically — use <strong>Replan Schedule</strong> afterwards if you want to redistribute them.
                  </span>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="edit-goal-title">Goal Title</label>
                <input
                  id="edit-goal-title"
                  type="text"
                  value={editForm.title}
                  onChange={(e) => { setEditForm((p) => ({ ...p, title: e.target.value })); setEditErrors((p) => ({ ...p, title: undefined })); }}
                />
                {editErrors.title && <div className="form-error" role="alert">{editErrors.title}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="edit-goal-category">Category</label>
                <select
                  id="edit-goal-category"
                  value={editForm.category}
                  onChange={(e) => setEditForm((p) => ({ ...p, category: e.target.value }))}
                >
                  {GOAL_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit-goal-deadline">Deadline</label>
                  <input
                    id="edit-goal-deadline"
                    type="date"
                    min={today}
                    value={editForm.deadline}
                    onChange={(e) => { setEditForm((p) => ({ ...p, deadline: e.target.value })); setEditErrors((p) => ({ ...p, deadline: undefined })); }}
                  />
                  {editErrors.deadline && <div className="form-error" role="alert">{editErrors.deadline}</div>}
                </div>
                <div className="form-group">
                  <label htmlFor="edit-goal-hours">Hours / Day</label>
                  <input
                    id="edit-goal-hours"
                    type="number"
                    min="0.5"
                    max="16"
                    step="0.5"
                    value={editForm.availableHoursPerDay}
                    onChange={(e) => { setEditForm((p) => ({ ...p, availableHoursPerDay: e.target.value })); setEditErrors((p) => ({ ...p, availableHoursPerDay: undefined })); }}
                  />
                  {editErrors.availableHoursPerDay && <div className="form-error" role="alert">{editErrors.availableHoursPerDay}</div>}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="edit-goal-level">Skill Level</label>
                <select
                  id="edit-goal-level"
                  value={editForm.skillLevel}
                  onChange={(e) => setEditForm((p) => ({ ...p, skillLevel: e.target.value }))}
                >
                  {SKILL_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="edit-goal-desc">Description (Optional)</label>
                <textarea
                  id="edit-goal-desc"
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                />
              </div>

              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowEditGoal(false)} type="button">Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveGoalEdit} type="button">Save Changes</button>
              </div>
            </div>
          </div>
        )}

        {/* Milestone Add/Edit Modal */}
        {showMilestoneModal && (
          <div className="modal-overlay" onClick={() => setShowMilestoneModal(false)} role="dialog" aria-modal="true" aria-label={editingMilestone ? 'Edit Milestone' : 'Add Milestone'}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{editingMilestone ? 'Edit Milestone' : 'Add Milestone'}</h2>
                <button className="btn-icon" onClick={() => setShowMilestoneModal(false)} aria-label="Close" type="button">
                  <X size={18} />
                </button>
              </div>
              <div className="form-group">
                <label htmlFor="ms-title">Title</label>
                <input
                  id="ms-title"
                  type="text"
                  value={milestoneForm.title}
                  onChange={(e) => { setMilestoneForm((p) => ({ ...p, title: e.target.value })); setMilestoneError(''); }}
                  autoFocus
                />
                {milestoneError && <div className="form-error" role="alert">{milestoneError}</div>}
              </div>
              <div className="form-group">
                <label htmlFor="ms-desc">Description (Optional)</label>
                <textarea
                  id="ms-desc"
                  rows={2}
                  value={milestoneForm.description}
                  onChange={(e) => setMilestoneForm((p) => ({ ...p, description: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="ms-date">Target Date</label>
                <input
                  id="ms-date"
                  type="date"
                  min={today}
                  max={goal.deadline}
                  value={milestoneForm.targetDate}
                  onChange={(e) => setMilestoneForm((p) => ({ ...p, targetDate: e.target.value }))}
                />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowMilestoneModal(false)} type="button">Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveMilestone} type="button">
                  {editingMilestone ? 'Save Changes' : 'Add Milestone'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
