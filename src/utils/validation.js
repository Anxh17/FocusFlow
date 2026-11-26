import { getTodayStr } from './dateUtils.js';

export const VALID_CATEGORIES = [
  'Placements',
  'Competitive Exam',
  'Technical Interview',
  'Learning',
  'Other',
];

export const VALID_SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'];

/**
 * Validate onboarding/goal form data.
 * Returns an object with field names as keys and error messages as values.
 */
export function validateGoalForm(data) {
  const errors = {};

  if (!data.title || !data.title.trim()) {
    errors.title = 'Goal title is required.';
  } else if (data.title.trim().length < 3) {
    errors.title = 'Goal title must be at least 3 characters.';
  }

  if (!data.category) {
    errors.category = 'Please select a goal category.';
  } else if (!VALID_CATEGORIES.includes(data.category)) {
    errors.category = 'Please select a valid category.';
  }

  if (!data.deadline) {
    errors.deadline = 'Please set a target deadline.';
  } else {
    const today = getTodayStr();
    if (data.deadline < today) {
      errors.deadline = 'Deadline cannot be in the past.';
    }
  }

  const hours = parseFloat(data.availableHoursPerDay);
  if (!data.availableHoursPerDay && data.availableHoursPerDay !== 0) {
    errors.availableHoursPerDay = 'Please enter your available hours per day.';
  } else if (isNaN(hours) || hours <= 0) {
    errors.availableHoursPerDay = 'Hours must be a positive number.';
  } else if (hours > 16) {
    errors.availableHoursPerDay = 'Please enter a realistic number of hours (max 16).';
  }

  if (!data.skillLevel) {
    errors.skillLevel = 'Please select your skill level.';
  } else if (!VALID_SKILL_LEVELS.includes(data.skillLevel)) {
    errors.skillLevel = 'Please select a valid skill level.';
  }

  return errors;
}

/**
 * Validate a task form.
 */
export function validateTaskForm(data) {
  const errors = {};

  if (!data.title || !data.title.trim()) {
    errors.title = 'Task title is required.';
  }

  if (!data.date) {
    errors.date = 'Please select a date.';
  }

  const mins = parseInt(data.estimatedMinutes, 10);
  if (!data.estimatedMinutes && data.estimatedMinutes !== 0) {
    errors.estimatedMinutes = 'Please enter estimated duration.';
  } else if (isNaN(mins) || mins <= 0) {
    errors.estimatedMinutes = 'Duration must be a positive number.';
  } else if (mins > 480) {
    errors.estimatedMinutes = 'Duration cannot exceed 8 hours (480 minutes).';
  }

  return errors;
}
