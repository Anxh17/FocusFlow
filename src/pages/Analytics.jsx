import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, AlertTriangle, CheckCircle2, Clock,
  Flag, RotateCcw, Sparkles, Loader2, X
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import { getTasks } from '../services/taskService.js';
import { getGoal } from '../services/goalService.js';
import { computeExecutionAnalytics } from '../services/analyticsService.js';
import {
  isDemoMode,
  generateSampleAnalyticsData,
  resetDemoWorkspace,
  exitDemoWorkspace,
} from '../services/demoService.js';
import { formatDuration, formatSecondsCompact, formatDisplayDate } from '../utils/dateUtils.js';
import Header from '../components/Header.jsx';
import EmptyState from '../components/EmptyState.jsx';

const CHART_COLORS = {
  primary: '#A78BFA',
  secondary: '#67E8F9',
  success: '#86EFAC',
  warning: '#fbbf24',
  error: '#f87171',
};

export default function Analytics() {
  const navigate = useNavigate();
  const [goal, setGoal] = useState(() => getGoal());
  const [tasks, setTasks] = useState(() => getTasks());
  const [generating, setGenerating] = useState(false);
  const [confirmDemoReplace, setConfirmDemoReplace] = useState(false);
  const [sampleNotice, setSampleNotice] = useState(null);

  const refreshAnalytics = useCallback(() => {
    setGoal(getGoal());
    setTasks(getTasks());
  }, []);

  function handleGenerateSampleData(force = false) {
    setGenerating(true);
    try {
      const res = generateSampleAnalyticsData({ force });
      if (res.requiresConfirmation) {
        setConfirmDemoReplace(true);
        return;
      }
      setConfirmDemoReplace(false);
      refreshAnalytics();
      setSampleNotice({
        taskCount: res.taskCount,
        start: res.dateRange.start,
        end: res.dateRange.end,
      });
    } finally {
      setGenerating(false);
    }
  }

  const generateButton = (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      onClick={() => handleGenerateSampleData(false)}
      disabled={generating}
    >
      {generating ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
      {generating ? 'Generating...' : isDemoMode() ? 'Regenerate Sample Data' : 'Generate Sample Data'}
    </button>
  );

  const confirmModal = confirmDemoReplace && (
    <div
      className="modal-overlay"
      onClick={() => setConfirmDemoReplace(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Enter Demo Workspace"
    >
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Enter Separate Demo Workspace?</h2>
          <button className="btn-icon" onClick={() => setConfirmDemoReplace(false)} aria-label="Close" type="button">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
          You currently have your own goal and tasks saved in this browser. Sample analytics data requires entering a separate demo workspace and will replace the active LocalStorage view. Your existing data will not be modified unless you confirm.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmDemoReplace(false)}>
            Keep My Data
          </button>
          <button type="button" className="btn btn-primary" onClick={() => handleGenerateSampleData(true)}>
            <Sparkles size={15} /> Enter Demo &amp; Generate Data
          </button>
        </div>
      </div>
    </div>
  );

  if (!goal) {
    return (
      <>
        <Header title="Analytics" action={generateButton} />
        <div className="page-body">
          <EmptyState
            icon={BarChart3}
            title="No data yet"
            message="Complete onboarding and start working on tasks to see your analytics, or generate realistic 30-day sample data."
            action={generateButton}
          />
          {confirmModal}
        </div>
      </>
    );
  }

  const milestones = goal.milestones || [];
  const analytics = computeExecutionAnalytics(tasks, milestones);
  const { completion, time, consistency, postponements, milestones: msStats } = analytics;

  const statusData = [
    { name: 'Completed', value: completion.completedCount, color: CHART_COLORS.success },
    {
      name: 'Pending',
      value: Math.max(0, completion.remainingCount - completion.overdueCount - completion.blockedCount),
      color: CHART_COLORS.primary,
    },
    { name: 'Blocked', value: completion.blockedCount, color: CHART_COLORS.warning },
    { name: 'Overdue', value: completion.overdueCount, color: CHART_COLORS.error },
  ].filter((d) => d.value > 0);

  const timeComparisonData = [
    {
      name: 'Total Duration (min)',
      Estimated: time.totalEstimatedMinutes,
      Actual: time.totalActualMinutes,
    },
  ];

  const postponementChartData = [
    { priority: 'High', Postponements: postponements.byPriority.high },
    { priority: 'Medium', Postponements: postponements.byPriority.medium },
    { priority: 'Low', Postponements: postponements.byPriority.low },
  ];

  return (
    <>
      <Header
        title="Execution Analytics"
        subtitle={`${completion.totalTasks} tasks · ${consistency.activeDaysCount} active day(s)`}
        action={generateButton}
      />
      <div className="page-body">
        {isDemoMode() && (
          <div className="demo-banner" role="region" aria-label="Sample Demo Workspace">
            <div>
              <strong>Sample Demo Workspace</strong>
              <span className="text-sm text-muted" style={{ marginLeft: 8 }}>
                Viewing generated sample data.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  resetDemoWorkspace();
                  setSampleNotice(null);
                  refreshAnalytics();
                }}
              >
                <RotateCcw size={14} /> Reset Demo
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  exitDemoWorkspace();
                  setSampleNotice(null);
                  navigate('/onboarding');
                }}
              >
                Exit Demo &amp; Set My Goal
              </button>
            </div>
          </div>
        )}

        {sampleNotice && (
          <div className="recovery-explanation-box" role="status" style={{ borderColor: 'rgba(134, 239, 172, 0.35)' }}>
            <strong style={{ color: 'var(--color-success)' }}>Sample dataset generated:</strong>{' '}
            {sampleNotice.taskCount} tasks across {formatDisplayDate(sampleNotice.start)} – {formatDisplayDate(sampleNotice.end)}.
            Analytics and AI Coach insights now reflect this dataset.
          </div>
        )}

        {/* A & B & D & E Summary Cards */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--color-success-muted)' }}>
              <CheckCircle2 color="var(--color-success)" />
            </div>
            <div className="stat-label">Task Completion</div>
            <div className="stat-value">{completion.completionPercentage}%</div>
            <div className="text-sm text-muted">
              {completion.completedCount} done · {completion.remainingCount} left · {completion.overdueCount} overdue
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--accent-secondary-muted)' }}>
              <Clock color="var(--accent-secondary)" />
            </div>
            <div className="stat-label">Time Intelligence</div>
            <div className="stat-value">{formatSecondsCompact(time.totalActualSeconds)}</div>
            <div className="text-sm text-muted">
              vs {formatDuration(time.totalEstimatedMinutes)} est ({time.trackedTaskCount} tracked)
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--color-warning-muted)' }}>
              <RotateCcw color="var(--color-warning)" />
            </div>
            <div className="stat-label">Postponements</div>
            <div className="stat-value">{postponements.totalPostponements}</div>
            <div className="text-sm text-muted">
              {postponements.repeatedlyPostponedCount} postponed 2+ times
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'var(--accent-primary-muted)' }}>
              <Flag color="var(--accent-primary)" />
            </div>
            <div className="stat-label">Milestone Progress</div>
            <div className="stat-value">{msStats.milestoneCompletionPct}%</div>
            <div className="text-sm text-muted">
              {msStats.completedMilestones}/{msStats.totalMilestones} milestones complete
            </div>
          </div>
        </div>

        {time.tasksWithoutActualCount > 0 && tasks.length > 0 && (
          <div className="sample-data-notice">
            <AlertTriangle />
            <span>
              {time.tasksWithoutActualCount} task(s) have no recorded timer sessions yet. Estimated time is never counted as actual time.
              {time.avgActualMinutesCompleted > 0 && ` Avg actual duration for completed tracked tasks: ${time.avgActualMinutesCompleted}m.`}
            </span>
          </div>
        )}

        {tasks.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No tasks to analyze yet"
            message="Add tasks and track execution time to populate your analytics."
          />
        ) : (
          <div className="analytics-grid">
            <div className="chart-card">
              <h3>7-Day Execution Overview</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={consistency.sevenDayOverview} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 13 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Planned" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Completed" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3>Task Status Distribution ({completion.blockedCount} Blocked)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={82}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 13 }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3>Planned vs Actual Duration (Minutes)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={timeComparisonData} margin={{ top: 5, right: 15, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 13 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Estimated" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Actual" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3>Postponements by Priority</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={postponementChartData} margin={{ top: 5, right: 15, bottom: 5, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="priority" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 13 }}
                  />
                  <Bar dataKey="Postponements" fill={CHART_COLORS.warning} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card" style={{ gridColumn: '1 / -1' }}>
              <h3>30-Day Productivity Trend</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={consistency.thirtyDayTrend} margin={{ top: 5, right: 15, bottom: 5, left: -15 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} minTickGap={18} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 13 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="Planned" stroke={CHART_COLORS.primary} fill="rgba(167, 139, 250, 0.16)" />
                  <Area type="monotone" dataKey="Completed" stroke={CHART_COLORS.success} fill="rgba(134, 239, 172, 0.22)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        {confirmModal}
      </div>
    </>
  );
}
