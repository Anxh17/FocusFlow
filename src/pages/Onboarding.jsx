import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ArrowRight, ArrowLeft, Target, Calendar, Clock, BarChart2, Sparkles } from 'lucide-react';
import { saveGoal } from '../services/goalService.js';
import { bulkAddTasks } from '../services/taskService.js';
import { generateInitialPlan, generateMilestones } from '../services/planningService.js';
import { hasRealUserData, loadDemoWorkspace } from '../services/demoService.js';
import { validateGoalForm } from '../utils/validation.js';
import { GOAL_CATEGORIES, SKILL_LEVELS } from '../data/demoData.js';
import { getTodayStr } from '../utils/dateUtils.js';

const STEPS = [
  { key: 'goal', title: 'What is your goal?', icon: Target },
  { key: 'details', title: 'Timeline & commitment', icon: Calendar },
  { key: 'level', title: 'Your experience', icon: BarChart2 },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    title: '',
    category: '',
    deadline: '',
    availableHoursPerDay: '',
    skillLevel: '',
    description: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function validateCurrentStep() {
    const stepErrors = {};
    if (step === 0) {
      if (!form.title.trim()) stepErrors.title = 'Goal title is required.';
      else if (form.title.trim().length < 3) stepErrors.title = 'Goal title must be at least 3 characters.';
      if (!form.category) stepErrors.category = 'Please select a goal category.';
    } else if (step === 1) {
      if (!form.deadline) stepErrors.deadline = 'Please set a target deadline.';
      else if (form.deadline < getTodayStr()) stepErrors.deadline = 'Deadline cannot be in the past.';
      const hours = parseFloat(form.availableHoursPerDay);
      if (!form.availableHoursPerDay && form.availableHoursPerDay !== 0) {
        stepErrors.availableHoursPerDay = 'Please enter your available hours per day.';
      } else if (isNaN(hours) || hours <= 0) {
        stepErrors.availableHoursPerDay = 'Hours must be a positive number.';
      } else if (hours > 16) {
        stepErrors.availableHoursPerDay = 'Please enter a realistic number of hours (max 16).';
      }
    } else if (step === 2) {
      if (!form.skillLevel) stepErrors.skillLevel = 'Please select your skill level.';
    }
    return stepErrors;
  }

  function handleNext() {
    const stepErrors = validateCurrentStep();
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    setStep((s) => s + 1);
  }

  function handleBack() {
    setErrors({});
    setStep((s) => s - 1);
  }

  function handleSubmit() {
    const allErrors = validateGoalForm(form);
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      return;
    }

    setSubmitting(true);
    try {
      const baseGoal = {
        title: form.title.trim(),
        category: form.category,
        deadline: form.deadline,
        availableHoursPerDay: parseFloat(form.availableHoursPerDay),
        skillLevel: form.skillLevel,
        description: form.description.trim(),
      };
      const milestones = generateMilestones(baseGoal);
      const goal = saveGoal({ ...baseGoal, milestones });
      const plan = generateInitialPlan(goal);
      bulkAddTasks(plan);
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Failed to save goal:', err);
      setErrors({ submit: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  const currentStep = STEPS[step];
  const StepIcon = currentStep.icon;

  return (
    <div className="onboarding-page">
      <div className="onboarding-container">
        <div className="onboarding-brand">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <Zap size={26} color="var(--accent-primary)" />
            <h1 style={{ margin: 0 }}>FocusFlow</h1>
          </div>
          <p>Your plans should adapt to your life.</p>
        </div>

        <div className="onboarding-card">
          <div className="onboarding-step">
            <StepIcon size={16} />
            Step {step + 1} of {STEPS.length} — {currentStep.title}
          </div>

          {step === 0 && (
            <>
              <div className="form-group">
                <label htmlFor="goal-title">Primary Goal Title</label>
                <input
                  id="goal-title"
                  type="text"
                  placeholder="e.g., Crack software engineering placements"
                  value={form.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  autoFocus
                />
                {errors.title && <div className="form-error" role="alert">{errors.title}</div>}
              </div>

              <div className="form-group">
                <label>Goal Category</label>
                <div className="category-grid" role="group" aria-label="Goal Category">
                  {GOAL_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`category-option${form.category === cat ? ' selected' : ''}`}
                      onClick={() => updateField('category', cat)}
                      aria-pressed={form.category === cat}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                {errors.category && <div className="form-error" role="alert">{errors.category}</div>}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="form-group">
                <label htmlFor="goal-deadline">Target Deadline</label>
                <input
                  id="goal-deadline"
                  type="date"
                  value={form.deadline}
                  min={getTodayStr()}
                  onChange={(e) => updateField('deadline', e.target.value)}
                  autoFocus
                />
                {errors.deadline && <div className="form-error" role="alert">{errors.deadline}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="goal-hours">Available Hours Per Day</label>
                <input
                  id="goal-hours"
                  type="number"
                  min="0.5"
                  max="16"
                  step="0.5"
                  placeholder="e.g., 3"
                  value={form.availableHoursPerDay}
                  onChange={(e) => updateField('availableHoursPerDay', e.target.value)}
                />
                <div className="text-sm text-muted" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Clock size={13} />
                  How many hours can you realistically dedicate each day?
                </div>
                {errors.availableHoursPerDay && <div className="form-error" role="alert">{errors.availableHoursPerDay}</div>}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="form-group">
                <label>Current Skill Level</label>
                <div className="skill-options" role="group" aria-label="Current Skill Level">
                  {SKILL_LEVELS.map((level) => (
                    <button
                      key={level.value}
                      type="button"
                      className={`skill-option${form.skillLevel === level.value ? ' selected' : ''}`}
                      onClick={() => updateField('skillLevel', level.value)}
                      aria-pressed={form.skillLevel === level.value}
                    >
                      <div className="skill-label">{level.label}</div>
                      <div className="skill-desc">{level.description}</div>
                    </button>
                  ))}
                </div>
                {errors.skillLevel && <div className="form-error" role="alert">{errors.skillLevel}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="goal-description">Short Description (Optional)</label>
                <textarea
                  id="goal-description"
                  placeholder="Any key focus areas or notes about your goal..."
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  rows={3}
                />
              </div>
            </>
          )}

          {errors.submit && <div className="form-error" role="alert" style={{ marginBottom: 16 }}>{errors.submit}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
            {step > 0 ? (
              <button className="btn btn-secondary" onClick={handleBack} type="button">
                <ArrowLeft size={16} /> Back
              </button>
            ) : (
              <div />
            )}
            {step < STEPS.length - 1 ? (
              <button className="btn btn-primary" onClick={handleNext} type="button">
                Next <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="btn btn-primary btn-lg"
                onClick={handleSubmit}
                disabled={submitting}
                type="button"
              >
                {submitting ? 'Creating Plan...' : 'Generate Starter Plan'}
                {!submitting && <ArrowRight size={17} />}
              </button>
            )}
          </div>
        </div>

        {!hasRealUserData() && (
          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const res = loadDemoWorkspace();
                if (res.loaded) navigate('/', { replace: true });
              }}
            >
              <Sparkles size={15} /> Try Interactive Demo Workspace
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
