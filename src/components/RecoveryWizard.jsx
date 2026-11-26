import { useState, useEffect, useRef } from 'react';
import {
  Sparkles, X, AlertTriangle, CheckCircle2, Clock, Calendar,
  ArrowRight, RefreshCw, ShieldAlert, Loader2, ArrowLeft, History
} from 'lucide-react';
import {
  RECOVERY_APPROACHES,
  EXPLANATION_CHIPS,
  buildRecoveryContext,
  requestRecoveryPlan,
  cancelInFlightRecoveryRequest,
  generateDevRecoveryPlan,
  validateRecoveryProposal,
  repairRecoveryProposal,
  enrichProposalDiffs,
  applyRecoveryPlan,
  saveRecoveryRecord,
} from '../services/recoveryService.js';
import { formatDisplayDate, formatDuration } from '../utils/dateUtils.js';

export default function RecoveryWizard({
  isOpen,
  goal,
  tasks,
  milestones,
  onApplied,
  onClose,
}) {
  const [step, setStep] = useState('configure'); // 'configure' | 'loading' | 'preview' | 'error' | 'success'
  const [explanation, setExplanation] = useState('');
  const [approach, setApproach] = useState('balanced');
  const [proposal, setProposal] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const isMountedRef = useRef(true);
  const isSubmittingRef = useRef(false);
  const activeGenerationIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      isSubmittingRef.current = false;
      activeGenerationIdRef.current += 1;
      cancelInFlightRecoveryRequest();
    };
  }, []);

  if (!isOpen || !goal) return null;

  const context = buildRecoveryContext(goal, tasks, milestones, explanation, approach);
  const { schedule, tasks: taskStats } = context;

  const upcomingMilestones = (milestones || [])
    .filter((m) => m.status !== 'completed' && m.targetDate)
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
    .slice(0, 2);

  function resetAndClose() {
    activeGenerationIdRef.current += 1;
    cancelInFlightRecoveryRequest();
    isSubmittingRef.current = false;
    if (proposal && step === 'preview') {
      saveRecoveryRecord({
        status: 'cancelled',
        approach,
        userExplanation: explanation,
        explanation: proposal.explanation,
        provider: proposal.provider,
        originalDates: tasks.filter((t) => t.status !== 'completed').map((t) => ({ taskId: t.id, date: t.date })),
        proposedDates: proposal.proposedSchedule,
        movedCount: proposal.movedTasks?.length || 0,
        unchangedCount: proposal.unchangedTaskIds?.length || 0,
        unscheduledCount: proposal.unscheduledTasks?.length || 0,
        summary: 'Cancelled by user without modifying schedule.',
        warnings: proposal.warnings || [],
      });
    }
    setStep('configure');
    setProposal(null);
    setAdjustments([]);
    setErrorMsg('');
    setErrorCode('');
    onClose();
  }

  function processAndShowProposal(rawProposal) {
    const validation = validateRecoveryProposal(rawProposal, tasks, goal);
    let finalProposal = rawProposal;
    let repairNotes = [];

    if (!validation.valid) {
      const repaired = repairRecoveryProposal(rawProposal, tasks, goal);
      finalProposal = repaired.proposal;
      repairNotes = repaired.adjustments;

      // Re-validate after deterministic repair
      const recheck = validateRecoveryProposal(finalProposal, tasks, goal);
      if (!recheck.valid) {
        setErrorMsg(`Proposal failed deterministic validation: ${recheck.issues.join(' ')}`);
        setErrorCode('VALIDATION_FAILED');
        setStep('error');
        return;
      }
    }

    const enriched = enrichProposalDiffs(finalProposal, tasks);
    console.info(`[Recovery:${rawProposal.requestId || 'local'}] Recovery plan validated`);
    setProposal(enriched);
    setAdjustments(repairNotes);
    setStep('preview');
  }

  async function handleGenerate() {
    if (isSubmittingRef.current || step === 'loading') return;
    isSubmittingRef.current = true;
    const generationId = ++activeGenerationIdRef.current;
    setStep('loading');
    setErrorMsg('');
    setErrorCode('');
    setAdjustments([]);

    let reqId = 'local';
    try {
      const ctx = buildRecoveryContext(goal, tasks, milestones, explanation, approach);
      const raw = await requestRecoveryPlan(ctx);
      reqId = raw.requestId || 'local';
      // Ignore late AI response if user already switched to fallback, cancelled, or unmounted
      if (!isMountedRef.current || generationId !== activeGenerationIdRef.current) return;
      processAndShowProposal(raw);
    } catch (err) {
      reqId = err.requestId || reqId;
      if (!isMountedRef.current || generationId !== activeGenerationIdRef.current) return;
      setErrorMsg(err.message || 'Failed to generate recovery plan.');
      setErrorCode(err.code || 'ERROR');
      setStep('error');
    } finally {
      if (generationId === activeGenerationIdRef.current) {
        isSubmittingRef.current = false;
      }
      console.info(`[Recovery:${reqId}] Loading state released`);
    }
  }

  function handleUseDevFallback() {
    activeGenerationIdRef.current += 1;
    cancelInFlightRecoveryRequest();
    isSubmittingRef.current = false;
    const ctx = buildRecoveryContext(goal, tasks, milestones, explanation, approach);
    const devPlan = generateDevRecoveryPlan(ctx);
    processAndShowProposal(devPlan);
  }

  function handleApply() {
    if (!proposal) return;
    try {
      const originalDates = tasks
        .filter((t) => t.status !== 'completed')
        .map((t) => ({ taskId: t.id, date: t.date }));

      applyRecoveryPlan(proposal, tasks);
      saveRecoveryRecord({
        status: 'applied',
        approach: proposal.approach || approach,
        userExplanation: explanation,
        explanation: proposal.explanation,
        provider: proposal.provider,
        originalDates,
        proposedDates: proposal.proposedSchedule,
        movedCount: proposal.movedTasks.length,
        unchangedCount: proposal.unchangedTaskIds.length,
        unscheduledCount: proposal.unscheduledTasks.length,
        summary: proposal.summary,
        warnings: proposal.warnings || [],
      });

      setStep('success');
      if (onApplied) onApplied();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to apply recovery plan.');
      setStep('error');
    }
  }

  const overdueIdSet = new Set(taskStats.overdue.map((t) => t.id));

  return (
    <div className="modal-overlay" onClick={resetAndClose} role="dialog" aria-modal="true" aria-label="AI Schedule Recovery">
      <div className="modal-content recovery-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="recovery-header-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>Recover My Day</h2>
              <div className="text-sm text-muted">Your plans should adapt to your life.</div>
            </div>
          </div>
          <button className="btn-icon" onClick={resetAndClose} aria-label="Close" type="button">
            <X size={18} />
          </button>
        </div>

        {/* STEP 1 & 2: SITUATION + EXPLANATION + APPROACH */}
        {step === 'configure' && (
          <div>
            {/* Situation Summary */}
            <div className="recovery-situation-grid">
              <div className="recovery-stat">
                <span className="recovery-stat-val" style={{ color: 'var(--color-success)' }}>{taskStats.completed.length}</span>
                <span className="recovery-stat-lbl">Completed</span>
              </div>
              <div className="recovery-stat">
                <span className="recovery-stat-val">{taskStats.pending.length}</span>
                <span className="recovery-stat-lbl">Pending</span>
              </div>
              <div className="recovery-stat">
                <span className="recovery-stat-val" style={{ color: taskStats.overdue.length > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>
                  {taskStats.overdue.length}
                </span>
                <span className="recovery-stat-lbl">Overdue</span>
              </div>
              <div className="recovery-stat">
                <span className="recovery-stat-val" style={{ color: taskStats.blocked.length > 0 ? 'var(--color-warning)' : 'var(--text-primary)' }}>
                  {taskStats.blocked.length}
                </span>
                <span className="recovery-stat-lbl">Blocked</span>
              </div>
            </div>

            <div className="recovery-meta-bar">
              <span><Clock size={14} /> {formatDuration(schedule.dailyCapacityMinutes)}/day ({formatDuration(schedule.estimatedRemainingTodayMinutes)} left today)</span>
              <span><Calendar size={14} /> Deadline: {formatDisplayDate(goal.deadline)} ({schedule.daysLeft}d left)</span>
              {upcomingMilestones.length > 0 && (
                <span>Next milestone: {upcomingMilestones[0].title} ({formatDisplayDate(upcomingMilestones[0].targetDate)})</span>
              )}
            </div>

            {/* Explanation */}
            <div className="form-group" style={{ marginTop: 16 }}>
              <label htmlFor="recovery-explanation">What happened? (Optional)</label>
              <div className="recovery-chips">
                {EXPLANATION_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className={`recovery-chip ${explanation === chip ? 'selected' : ''}`}
                    onClick={() => setExplanation(explanation === chip ? '' : chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <textarea
                id="recovery-explanation"
                rows={2}
                placeholder="Describe what threw your schedule off today..."
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
              />
            </div>

            {/* Approach */}
            <div className="form-group">
              <label>Recovery Approach</label>
              <div className="recovery-approach-grid">
                {RECOVERY_APPROACHES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`recovery-approach-card ${approach === item.id ? 'selected' : ''}`}
                    onClick={() => setApproach(item.id)}
                  >
                    <div className="recovery-approach-title">{item.label}</div>
                    <div className="recovery-approach-desc">{item.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={resetAndClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={taskStats.pending.length === 0}
              >
                <Sparkles size={16} /> Generate Recovery Plan
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: LOADING */}
        {step === 'loading' && (
          <div className="recovery-loading" role="status" aria-live="polite">
            <Loader2 size={36} className="spin" color="var(--accent-primary)" />
            <h3>Building your revised schedule...</h3>
            <p className="text-sm text-muted">
              Analyzing {taskStats.pending.length} pending tasks, dependencies, priorities, and your {formatDuration(schedule.dailyCapacityMinutes)}/day capacity.
            </p>
          </div>
        )}

        {/* ERROR STATE */}
        {step === 'error' && (
          <div className="recovery-error-state">
            <div className="error-banner" role="alert">
              <ShieldAlert size={18} />
              <span>{errorMsg}</span>
            </div>
            {(errorCode === 'AI_NOT_CONFIGURED' || errorCode === 'SERVER_ERROR' || errorMsg.includes('Failed to fetch')) && (
              <div className="sample-data-notice" style={{ marginBottom: 16 }}>
                <AlertTriangle size={16} />
                <div>
                  <strong>Server AI not configured or unreachable.</strong> Set <code>OPENROUTER_API_KEY</code> (or <code>GEMINI_API_KEY</code> with <code>AI_PROVIDER=gemini</code>) in your server environment and run <code>npm run server</code>. For local testing, you can use the built-in deterministic recovery engine.
                </div>
              </div>
            )}
            {(errorCode === 'AI_INVALID_KEY' || errorCode === 'AI_INVALID_MODEL') && (
              <div className="sample-data-notice" style={{ marginBottom: 16 }}>
                <AlertTriangle size={16} />
                <div>
                  <strong>Server configuration issue ({errorCode}):</strong> Check your server API key or free model ID in <code>.env</code>.
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setStep('configure')}>
                <ArrowLeft size={15} /> Back
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleUseDevFallback}>
                Use Dev/Test Deterministic Fallback
              </button>
              <button type="button" className="btn btn-primary" onClick={handleGenerate}>
                <RefreshCw size={15} /> Retry AI
              </button>
            </div>
          </div>
        )}

        {/* STEP 4 & 5: PREVIEW & APPROVAL */}
        {step === 'preview' && proposal && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span className={`badge ${proposal.isDevProvider || proposal.isFallback ? 'badge-info' : 'badge-accent'}`}>
                {proposal.isFallback
                  ? 'Built-in Deterministic Engine (Fallback)'
                  : proposal.isDevProvider
                    ? 'Built-in Deterministic Engine'
                    : `AI Provider: ${proposal.provider}${proposal.model ? ` (${proposal.model})` : ''}`}
              </span>
              <span className="text-sm text-muted">{proposal.summary}</span>
            </div>

            {proposal.isFallback && (
              <div className="sample-data-notice" role="status" style={{ marginBottom: 12 }}>
                <AlertTriangle size={16} />
                <span>
                  {proposal.fallbackMessage || 'AI is temporarily unavailable. FocusFlow created a schedule using its built-in recovery engine instead.'}
                </span>
              </div>
            )}

            <div className="recovery-explanation-box">
              {proposal.explanation}
            </div>

            {adjustments.length > 0 && (
              <div className="sample-data-notice" style={{ marginBottom: 12 }}>
                <AlertTriangle size={16} />
                <div>
                  <strong>Deterministic Guardrail Adjustments:</strong> {adjustments.length} constraint issue(s) in the raw proposal were automatically repaired to protect capacity, deadline, and dependencies.
                </div>
              </div>
            )}

            {!proposal.feasible && (
              <div className="error-banner" role="status" style={{ marginBottom: 12 }}>
                <AlertTriangle size={16} />
                <span>
                  {proposal.unscheduledTasks.length} task(s) cannot fit before {formatDisplayDate(goal.deadline)}.
                </span>
              </div>
            )}

            {proposal.warnings && proposal.warnings.length > 0 && (
              <ul className="recovery-warnings">
                {proposal.warnings.map((w, i) => (
                  <li key={i}><AlertTriangle size={13} /> {w}</li>
                ))}
              </ul>
            )}

            {/* Moved Tasks */}
            <div className="recovery-section">
              <h4>Moved Tasks ({proposal.movedTasks.length})</h4>
              {proposal.movedTasks.length === 0 ? (
                <p className="text-sm text-muted">No tasks needed to be moved.</p>
              ) : (
                <div className="preview-list">
                  {proposal.movedTasks.map((m) => (
                    <div key={m.taskId} className="preview-item recovery-moved">
                      <div>
                        <div className="preview-item-title">
                          {m.title}
                          {overdueIdSet.has(m.taskId) && (
                            <span className="badge badge-high" style={{ marginLeft: 8 }}>Was Overdue</span>
                          )}
                        </div>
                        <div className="text-sm text-muted">
                          {formatDisplayDate(m.fromDate)} <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> <strong>{formatDisplayDate(m.toDate)}</strong>
                        </div>
                      </div>
                      <span className="badge badge-accent">Moved</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Unchanged Tasks */}
            {proposal.unchangedTaskIds.length > 0 && (
              <div className="recovery-section">
                <h4>Unchanged Tasks ({proposal.unchangedTaskIds.length})</h4>
                <div className="preview-list">
                  {proposal.unchangedTaskIds.map((id) => {
                    const t = proposal.taskMap.get(id);
                    if (!t) return null;
                    return (
                      <div key={id} className="preview-item">
                        <span className="preview-item-title">{t.title}</span>
                        <span className="text-sm text-muted">{formatDisplayDate(t.date)} · Unchanged</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Unscheduled Tasks */}
            {proposal.unscheduledTasks.length > 0 && (
              <div className="recovery-section">
                <h4>Unscheduled Tasks ({proposal.unscheduledTasks.length})</h4>
                <div className="preview-list">
                  {proposal.unscheduledTasks.map((u) => (
                    <div key={u.taskId} className="preview-item unscheduled">
                      <div>
                        <div className="preview-item-title">{u.title}</div>
                        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{u.reason}</div>
                      </div>
                      <span className="badge badge-high">Unscheduled</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Daily Workload Comparison */}
            {proposal.dailyWorkload.length > 0 && (
              <div className="recovery-section">
                <h4>Daily Workload (Before vs After)</h4>
                <div className="workload-grid">
                  {proposal.dailyWorkload.map((day) => (
                    <div key={day.date} className="workload-row">
                      <span className="text-sm">{day.label}</span>
                      <span className="text-sm text-muted">
                        {formatDuration(day.beforeMinutes)} <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> <strong style={{ color: 'var(--text-primary)' }}>{formatDuration(day.afterMinutes)}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={resetAndClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleGenerate}>
                <RefreshCw size={15} /> Regenerate Plan
              </button>
              <button type="button" className="btn btn-primary" onClick={handleApply}>
                <CheckCircle2 size={16} /> Apply Recovery Plan
              </button>
            </div>
          </div>
        )}

        {/* SUCCESS CONFIRMATION */}
        {step === 'success' && (
          <div className="recovery-success" style={{ textAlign: 'center', padding: '16px 0' }}>
            <div className="recover-modal-icon" style={{ background: 'var(--color-success-muted)' }}>
              <CheckCircle2 size={28} color="var(--color-success)" />
            </div>
            <h3>Schedule Recovered!</h3>
            <p className="text-sm text-muted" style={{ marginTop: 8, marginBottom: 20 }}>
              Your revised schedule has been applied. Completed tasks, timer sessions, milestones, and dependencies were preserved.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => { setStep('configure'); setProposal(null); onClose(); }}>
              <History size={15} /> Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
