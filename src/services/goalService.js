import { loadState, saveState } from './storageService.js';

export function getGoal() {
  const state = loadState();
  return state.goal;
}

export function saveGoal(goal) {
  const state = loadState();
  const now = new Date().toISOString();
  state.goal = {
    ...goal,
    id: goal.id || crypto.randomUUID(),
    milestones: Array.isArray(goal.milestones) ? goal.milestones : (state.goal?.milestones || []),
    createdAt: goal.createdAt || now,
    updatedAt: now,
  };
  state.onboardingComplete = true;
  localStorage.removeItem('focusflow_demo_mode');
  saveState(state);
  return state.goal;
}

export function updateGoal(updates) {
  const state = loadState();
  if (!state.goal) return null;
  state.goal = {
    ...state.goal,
    ...updates,
    milestones: Array.isArray(updates.milestones) ? updates.milestones : (state.goal.milestones || []),
    updatedAt: new Date().toISOString(),
  };
  saveState(state);
  return state.goal;
}

export function isOnboardingComplete() {
  const state = loadState();
  return state.onboardingComplete && state.goal !== null;
}
