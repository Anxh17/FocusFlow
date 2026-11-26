const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };

/**
 * Detect if adding candidateDepId as a dependency of taskId would create a cycle.
 * Returns true if invalid (self-dependency or circular dependency).
 */
export function wouldCreateCycle(taskId, candidateDepId, allTasks) {
  if (!taskId || !candidateDepId) return false;
  if (taskId === candidateDepId) return true;

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const visited = new Set();
  const stack = [candidateDepId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (currentId === taskId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const current = taskMap.get(currentId);
    if (current && Array.isArray(current.dependencies)) {
      for (const depId of current.dependencies) {
        if (!visited.has(depId)) {
          stack.push(depId);
        }
      }
    }
  }

  return false;
}

/**
 * Validate a proposed dependencies array for a given task.
 */
export function validateDependencies(taskId, proposedDeps, allTasks) {
  if (!Array.isArray(proposedDeps)) return { valid: true, cleanDeps: [] };
  const validIds = new Set(allTasks.map((t) => t.id));
  const cleanDeps = [];

  for (const depId of proposedDeps) {
    if (!validIds.has(depId)) continue;
    if (depId === taskId) {
      return { valid: false, error: 'A task cannot depend on itself.', cleanDeps: [] };
    }
    if (wouldCreateCycle(taskId, depId, allTasks)) {
      return { valid: false, error: 'Circular dependency detected.', cleanDeps: [] };
    }
    if (!cleanDeps.includes(depId)) {
      cleanDeps.push(depId);
    }
  }

  return { valid: true, cleanDeps };
}

/**
 * Check whether a task is currently blocked by any incomplete prerequisite.
 */
export function isTaskBlocked(task, allTasks) {
  if (!task || task.status === 'completed') return false;
  if (!Array.isArray(task.dependencies) || task.dependencies.length === 0) return false;

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  return task.dependencies.some((depId) => {
    const prereq = taskMap.get(depId);
    return prereq && prereq.status !== 'completed';
  });
}

/**
 * Get the list of incomplete prerequisite task objects for a task.
 */
export function getBlockingPrerequisites(task, allTasks) {
  if (!task || !Array.isArray(task.dependencies) || task.dependencies.length === 0) return [];
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  return task.dependencies
    .map((depId) => taskMap.get(depId))
    .filter((prereq) => prereq && prereq.status !== 'completed');
}

/**
 * Topological sort of tasks respecting dependencies, priority, and original date.
 */
export function sortTasksForScheduling(tasks) {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map();
  const dependents = new Map();

  for (const t of tasks) {
    inDegree.set(t.id, 0);
    dependents.set(t.id, []);
  }

  for (const t of tasks) {
    const deps = Array.isArray(t.dependencies) ? t.dependencies : [];
    for (const depId of deps) {
      if (taskMap.has(depId)) {
        inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
        dependents.get(depId).push(t.id);
      }
    }
  }

  const compareTasks = (a, b) => {
    const pDiff = (PRIORITY_WEIGHT[a.priority] ?? 1) - (PRIORITY_WEIGHT[b.priority] ?? 1);
    if (pDiff !== 0) return pDiff;
    const dA = a.date || '9999-12-31';
    const dB = b.date || '9999-12-31';
    if (dA !== dB) return dA.localeCompare(dB);
    return (a.estimatedMinutes || 30) - (b.estimatedMinutes || 30);
  };

  const ready = tasks.filter((t) => inDegree.get(t.id) === 0).sort(compareTasks);
  const result = [];

  while (ready.length > 0) {
    const current = ready.shift();
    result.push(current);

    for (const depTaskId of dependents.get(current.id) || []) {
      const nextDeg = inDegree.get(depTaskId) - 1;
      inDegree.set(depTaskId, nextDeg);
      if (nextDeg === 0) {
        ready.push(taskMap.get(depTaskId));
        ready.sort(compareTasks);
      }
    }
  }

  // Fallback for any remaining tasks if a cycle somehow existed
  if (result.length < tasks.length) {
    const seen = new Set(result.map((t) => t.id));
    const remaining = tasks.filter((t) => !seen.has(t.id)).sort(compareTasks);
    result.push(...remaining);
  }

  return result;
}
