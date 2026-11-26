import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { Calendar, Award, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatDuration } from '../utils/dateUtils.js';

export default function WeeklyReportCard({ report }) {
  if (!report) return null;

  const hasChartData = report.dailyTrend.some((d) => d.Planned > 0 || d.Completed > 0);

  return (
    <div className="coach-card">
      <div className="section-header" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>
          <Calendar /> Weekly Productivity Report
        </h3>
        <span className="text-sm text-muted">
          {report.windowStart} to {report.windowEnd}
        </span>
      </div>

      <div className="weekly-metrics-grid">
        <div className="weekly-metric">
          <div className="text-sm text-muted">Tasks Completed</div>
          <div className="weekly-metric-val">{report.tasksCompleted}</div>
          <div className="text-sm text-muted">
            {report.completionRate !== null ? `${report.completionRate}% of ${report.tasksPlanned} planned` : 'No tasks planned this week'}
          </div>
        </div>

        <div className="weekly-metric">
          <div className="text-sm text-muted">Focus Time</div>
          <div className="weekly-metric-val" style={{ color: 'var(--accent-secondary)' }}>
            {report.focusTimeFormatted}
          </div>
          <div className="text-sm text-muted">
            vs {formatDuration(report.plannedMinutes)} planned
          </div>
        </div>

        <div className="weekly-metric">
          <div className="text-sm text-muted">Postponements</div>
          <div className="weekly-metric-val" style={{ color: report.postponements > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
            {report.postponements}
          </div>
          <div className="text-sm text-muted">Last 7 days</div>
        </div>

        <div className="weekly-metric">
          <div className="text-sm text-muted">Best Productivity Day</div>
          <div className="weekly-metric-val" style={{ fontSize: '1.05rem', color: 'var(--color-success)' }}>
            {report.bestProductivityDay ? `${report.bestProductivityDay.day}` : 'Not enough data'}
          </div>
          <div className="text-sm text-muted">
            {report.bestProductivityDay
              ? `${report.bestProductivityDay.completedCount} completed`
              : 'Complete tasks on 2+ days'}
          </div>
        </div>
      </div>

      {hasChartData && (
        <div style={{ width: '100%', height: 220, marginTop: 18 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={report.dailyTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#26263a" />
              <XAxis dataKey="day" stroke="#9494a8" fontSize={12} />
              <YAxis allowDecimals={false} stroke="#9494a8" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: '#191927',
                  border: '1px solid #26263a',
                  borderRadius: 8,
                  color: '#f1f1f4',
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Planned" fill="#A78BFA" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Completed" fill="#86EFAC" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="weekly-insights-split">
        <div className="weekly-obstacle-box">
          <div className="weekly-box-title">
            <AlertCircle size={15} color="var(--color-warning)" /> Main Productivity Obstacle
          </div>
          <p className="text-sm text-muted">{report.mainObstacle}</p>
        </div>

        <div className="weekly-improvements-box">
          <div className="weekly-box-title">
            <Award size={15} color="var(--accent-primary)" /> 3 Actionable Improvements
          </div>
          <ul className="weekly-improvements-list">
            {report.threeImprovements.map((imp, idx) => (
              <li key={idx} className="text-sm">
                <CheckCircle2 size={14} color="var(--color-success)" />
                <span>{imp}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
