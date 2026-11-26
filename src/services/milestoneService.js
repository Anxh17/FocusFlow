import { loadState, saveState } from './storageService.js';
import { addDaysLocal, daysUntil, getTodayStr } from '../utils/dateUtils.js';

const CATEGORY_MILESTONES = {
  placements: [
    { title: 'Programming fundamentals', description: 'Solidify syntax, complexity analysis, and problem-solving basics.' },
    { title: 'Data structures and algorithms', description: 'Master arrays, trees, graphs, and dynamic programming patterns.' },
    { title: 'Core computer science subjects', description: 'Review OS, DBMS, SQL, and Computer Networks.' },
    { title: 'Interview preparation', description: 'Practice timed coding rounds and behavioral STAR responses.' },
    { title: 'Mock interviews and revision', description: 'Run full mock sessions and revise weak areas.' },
  ],
  competitive_exam: [
    { title: 'Core concept preparation', description: 'Cover foundational syllabus topics and theory.' },
    { title: 'Topic-wise practice', description: 'Build accuracy across individual subject areas.' },
    { title: 'Previous-year questions', description: 'Analyze exam patterns and solve past papers.' },
    { title: 'Mock examinations', description: 'Take timed full-length practice tests.' },
    { title: 'Final revision', description: 'Consolidate formulas, shortcuts, and error logs.' },
  ],
  technical_interview: [
    { title: 'Coding fundamentals', description: 'Sharpen algorithmic thinking and clean implementation.' },
    { title: 'Data structures', description: 'Practice medium-to-hard problems across core structures.' },
    { title: 'System design', description: 'Study scalability, APIs, databases, and trade-offs.' },
    { title: 'Technical practice', description: 'Practice live coding and explaining thought processes.' },
    { title: 'Mock interviews', description: 'Simulate end-to-end technical and behavioral loops.' },
  ],
  learning: [
    { title: 'Foundation', description: 'Learn core terminology and mental models.' },
    { title: 'Guided practice', description: 'Work through structured exercises and examples.' },
    { title: 'Applied learning', description: 'Solve independent problems without step-by-step guides.' },
    { title: 'Project work', description: 'Build a real artifact to test your understanding.' },
    { title: 'Revision', description: 'Review key concepts and document takeaways.' },
  ],
  other: [
    { title: 'Goal setup & scope', description: 'Define clear deliverables and daily routines.' },
    { title: 'Core execution', description: 'Complete the highest-leverage work blocks.' },
    { title: 'Review & refinement', description: 'Close gaps, polish output, and wrap up.' },
  ],
};

function getCategoryKey(category) {
  if (!category) return 'other';
  const normalized = category.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized.includes('placement')) return 'placements';
  if (normalized.includes('competitive') || normalized.includes('exam')) return 'competitive_exam';
  if (normalized.includes('technical') || normalized.includes('interview')) return 'technical_interview';
  if (normalized.includes('learn')) return 'learning';
  return 'other';
}

/**
 * Generate deterministic milestones distributed realistically between today and goal.deadline.
 */
export function generateMilestones(goal) {
  const catKey = getCategoryKey(goal?.category);
  const templates = CATEGORY_MILESTONES[catKey] || CATEGORY_MILESTONES.other;
  const today = getTodayStr();
  const totalDays = Math.max(1, daysUntil(goal?.deadline || today));

  // If deadline is very short, keep milestone count proportional
  const count = totalDays < templates.length ? Math.max(2, Math.min(templates.length, totalDays)) : templates.length;
  const selected = templates.slice(0, count);
  const now = new Date().toISOString();

  return selected.map((tpl, idx) => {
    const fraction = (idx + 1) / selected.length;
    const offsetDays = Math.max(0, Math.round(totalDays * fraction));
    const targetDate = addDaysLocal(today, offsetDays);
    return {
      id: crypto.randomUUID(),
      title: tpl.title,
      description: tpl.description,
      targetDate: goal?.deadline && targetDate > goal.deadline ? goal.deadline : targetDate,
      status: 'pending',
      createdAt: now,
    };
  });
}

export function getMilestones() {
  const state = loadState();
  return state.goal?.milestones || [];
}

export function getMilestoneProgress(milestoneId, tasks) {
  const associated = tasks.filter((t) => t.milestoneId === milestoneId);
  const completed = associated.filter((t) => t.status === 'completed').length;
  const total = associated.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, percentage, associatedTasks: associated };
}

export function saveMilestones(milestones) {
  const state = loadState();
  if (!state.goal) return [];
  state.goal.milestones = milestones;
  state.goal.updatedAt = new Date().toISOString();
  saveState(state);
  return state.goal.milestones;
}

export function addMilestone(milestone) {
  const state = loadState();
  if (!state.goal) return null;
  const newMilestone = {
    id: crypto.randomUUID(),
    title: milestone.title.trim(),
    description: (milestone.description || '').trim(),
    targetDate: milestone.targetDate || state.goal.deadline,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  state.goal.milestones = [...(state.goal.milestones || []), newMilestone];
  state.goal.updatedAt = new Date().toISOString();
  saveState(state);
  return newMilestone;
}

export function updateMilestone(id, updates) {
  const state = loadState();
  if (!state.goal || !Array.isArray(state.goal.milestones)) return null;
  const idx = state.goal.milestones.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  state.goal.milestones[idx] = {
    ...state.goal.milestones[idx],
    ...updates,
  };
  state.goal.updatedAt = new Date().toISOString();
  saveState(state);
  return state.goal.milestones[idx];
}

export function toggleMilestoneStatus(id) {
  const state = loadState();
  if (!state.goal || !Array.isArray(state.goal.milestones)) return null;
  const milestone = state.goal.milestones.find((m) => m.id === id);
  if (!milestone) return null;
  milestone.status = milestone.status === 'completed' ? 'pending' : 'completed';
  state.goal.updatedAt = new Date().toISOString();
  saveState(state);
  return milestone;
}

export function deleteMilestone(id) {
  const state = loadState();
  if (!state.goal) return;
  state.goal.milestones = (state.goal.milestones || []).filter((m) => m.id !== id);
  state.tasks = (state.tasks || []).map((t) =>
    t.milestoneId === id ? { ...t, milestoneId: null } : t
  );
  state.goal.updatedAt = new Date().toISOString();
  saveState(state);
}
