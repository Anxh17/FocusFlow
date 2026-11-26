import { wouldCreateCycle } from '../utils/schedulingUtils.js';

export default function DependencySelector({
  currentTaskId,
  allTasks,
  selectedIds = [],
  onChange,
}) {
  const candidates = allTasks.filter((t) => t.id !== currentTaskId);

  if (candidates.length === 0) {
    return (
      <div className="text-sm text-muted">
        No other tasks available to set as prerequisites.
      </div>
    );
  }

  function toggleDep(depId) {
    if (selectedIds.includes(depId)) {
      onChange(selectedIds.filter((id) => id !== depId));
    } else {
      onChange([...selectedIds, depId]);
    }
  }

  return (
    <div className="dependency-list" role="group" aria-label="Prerequisite tasks">
      {candidates.map((candidate) => {
        const checked = selectedIds.includes(candidate.id);
        const createsCycle = currentTaskId
          ? wouldCreateCycle(currentTaskId, candidate.id, allTasks)
          : false;

        return (
          <label
            key={candidate.id}
            className={`dependency-option${checked ? ' selected' : ''}${createsCycle ? ' disabled' : ''}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={createsCycle}
              onChange={() => toggleDep(candidate.id)}
              style={{ width: 'auto', minHeight: 'unset' }}
            />
            <span className="dependency-option-title">
              {candidate.title}
              {candidate.status === 'completed' && (
                <span className="text-sm text-muted"> (completed)</span>
              )}
              {createsCycle && (
                <span className="text-sm" style={{ color: 'var(--color-error)' }}> (would create cycle)</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
