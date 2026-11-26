import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Target, Clock, TrendingUp, AlertTriangle,
  CheckCircle2, ArrowRight, Lightbulb, RotateCcw
} from 'lucide-react';
import { getGoal } from '../services/goalService.js';
import { getTasks } from '../services/taskService.js';
import { getMilestones } from '../services/milestoneService.js';
import { computeProductivityIntelligence, generateWeeklyReport } from '../services/coachService.js';
import {
  getTodayStr, getGreeting, formatDuration, formatSecondsCompact, formatDisplayDate
} from '../utils/dateUtils.js';
import Header from '../components/Header.jsx';
import EmptyState from '../components/EmptyState.jsx';
import WeeklyReportCard from '../components/WeeklyReportCard.jsx';
import CoachChat from '../components/CoachChat.jsx';
import RecoveryWizard from '../components/RecoveryWizard.jsx';

export default function Coach() {
  const navigate = useNavigate();
  const [goal, setGoal] = useState(() => getGoal());
  const [tasks, setTasks] = useState(() => getTasks());
  const [milestones, setMilestones] = useState(() => getMilestones());
  const [showRecover, setShowRecover] = useState(false);

  const refreshData = useCallback(() => {
    setGoal(getGoal());
    setTasks(getTasks());
    setMilestones(getMilestones());
  }, []);

  if (!goal) {
    return (
      <>
        <Header title="AI Coach" />
        <div className="page-body">
          <EmptyState
            icon={Sparkles}
            title="No goal set yet"
            message="Complete onboarding to unlock personalized coaching, weekly reports, and AI guidance."
            action={
              <button className="btn btn-primary" onClick={() => navigate('/onboarding')} type="button">
                Set Up My Goal <ArrowRight size={16} />
              </button>
            }
          />
        </div>
      </>
    );
  }

  const today = getTodayStr();
  const intelligence = computeProductivityIntelligence(goal, tasks, milestones, today);
  const weeklyReport = generateWeeklyReport(goal, tasks, milestones, today);
  const { analytics, workload, focus, procrastination, deadlineWarnings, recommendations } = intelligence;

  function handleRecommendationAction(rec) {
    if (rec.actionType === 'recover') {
      setShowRecover(true);
    } else if (rec.actionType === 'tasks') {
      navigate('/tasks');
    }
  }

  return (
    <>
      <Header
        title={`${getGreeting()} — AI Coach`}
        subtitle={`${goal.title} · Deadline ${formatDisplayDate(goal.deadline)}`}
        action={
          <button className="btn btn-primary btn-sm" onClick={() => setShowRecover(true)} type="button">
            <Sparkles size={15} /> Recover My Day
          </button>
        }
      />

      <div className="page-body">
        {/* Deadline Warnings */}
        {deadlineWarnings.length > 0 && (
          <div className="sample-data-notice" role="status" style={{ marginBottom: 20 }}>
            <AlertTriangle size={16} />
            <div>
              <strong>Upcoming Deadline Alert:</strong> {deadlineWarnings[0].message}
            </div>
          </div>
        )}

        {/* Productivity Overview */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--color-success-muted)' }}>
              <CheckCircle2 color="var(--color-success)" />
            </div>
            <div className="stat-label">Completion Rate</div>
            <div className="stat-value">{analytics.completion.completionPercentage}%</div>
            <div className="text-sm text-muted">
              {analytics.completion.completedCount} done · {analytics.completion.remainingCount} pending
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--accent-primary-muted)' }}>
              <Target color="var(--accent-primary)" />
            </div>
            <div className="stat-label">Today&apos;s Workload</div>
            <div className="stat-value" style={{ color: workload.isOverloadedToday ? 'var(--color-warning)' : 'var(--text-primary)' }}>
              {formatDuration(workload.todayPlannedMinutes)}
            </div>
            <div className="text-sm text-muted">
              {workload.workloadUtilizationPct}% of {formatDuration(workload.dailyCapacityMinutes)} capacity
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--accent-secondary-muted)' }}>
              <Clock color="var(--accent-secondary)" />
            </div>
            <div className="stat-label">Focus Time Tracked</div>
            <div className="stat-value">{formatSecondsCompact(focus.totalActualSeconds)}</div>
            <div className="text-sm text-muted">
              {focus.hasActualData
                ? `${focus.totalFocusSessions} session(s) · ${Math.round((focus.durationAccuracyRatio || 1) * 100)}% vs est`
                : 'No timer sessions recorded yet'}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--color-warning-muted)' }}>
              <RotateCcw color="var(--color-warning)" />
            </div>
            <div className="stat-label">Overdue &amp; Postponed</div>
            <div className="stat-value">{workload.overdueCount} overdue</div>
            <div className="text-sm text-muted">
              {analytics.postponements.totalPostponements} postponement(s) · {workload.incompleteHighPriorityCount} high-priority left
            </div>
          </div>
        </div>

        <div className="coach-layout-grid">
          <div className="coach-main-col">
            {/* Personalized Recommendations */}
            <div className="coach-card">
              <h3><Lightbulb /> Personalized Recommendations</h3>
              {recommendations.length === 0 ? (
                <p className="text-sm text-muted">
                  Add tasks to your plan to receive tailored pacing and workload recommendations.
                </p>
              ) : (
                recommendations.map((rec) => (
                  <div className="coach-rec-item" key={rec.id}>
                    <div className="coach-rec-body">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span className={`badge badge-${rec.priority}`}>{rec.priority}</span>
                        <h4>{rec.title}</h4>
                      </div>
                      <p className="text-sm text-muted">
                        <strong>Why:</strong> {rec.why}
                      </p>
                    </div>
                    {rec.actionType !== 'none' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRecommendationAction(rec)}
                      >
                        {rec.actionLabel} <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Supportive Friction / Procrastination Patterns */}
            <div className="coach-card">
              <h3><TrendingUp /> Execution &amp; Pacing Patterns</h3>
              {!procrastination.hasFriction ? (
                <div className="coach-tip">
                  <div className="coach-tip-icon" style={{ background: 'var(--color-success-muted)' }}>
                    <CheckCircle2 color="var(--color-success)" />
                  </div>
                  <div className="coach-tip-content">
                    <h4>Steady execution signals</h4>
                    <p>
                      No repeated postponements or major time overruns detected in your current history.
                    </p>
                  </div>
                </div>
              ) : (
                procrastination.frictionIndicators.map((ind) => (
                  <div className="coach-tip" key={ind.id}>
                    <div className="coach-tip-icon" style={{ background: 'var(--color-warning-muted)' }}>
                      <AlertTriangle color="var(--color-warning)" />
                    </div>
                    <div className="coach-tip-content">
                      <h4>{ind.title}</h4>
                      <p>{ind.detail}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Weekly Productivity Report */}
            <WeeklyReportCard report={weeklyReport} />
          </div>

          {/* Context-Aware AI Chat */}
          <div className="coach-chat-col">
            <CoachChat goal={goal} tasks={tasks} milestones={milestones} />
          </div>
        </div>

        <RecoveryWizard
          isOpen={showRecover}
          goal={goal}
          tasks={tasks}
          milestones={milestones}
          onApplied={refreshData}
          onClose={() => { setShowRecover(false); refreshData(); }}
        />
      </div>
    </>
  );
}
