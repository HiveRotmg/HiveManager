export type DodgeMovementIntentMode = 'goal' | 'combat_range';

export type DodgeMovementIntentId = string | number;

export interface GoalDodgeIntent {
  mode: 'goal';
  goalX: number;
  goalY: number;
  goalId?: DodgeMovementIntentId;
  arriveThreshold?: number;
}

export interface CombatRangeDodgeIntent {
  mode: 'combat_range';
  /** Runtime object id. Zero is reserved for legacy coordinate-only callers. */
  targetId: number;
  targetX: number;
  targetY: number;
  hardMinimumRange: number;
  preferredMinimumRange: number;
  preferredMaximumRange: number;
}

export type DodgeMovementIntent = GoalDodgeIntent | CombatRangeDodgeIntent;

export function normalizeDodgeMovementIntent(
  intent: DodgeMovementIntent,
): DodgeMovementIntent | undefined {
  if (intent.mode === 'goal') {
    if (!finitePoint(intent.goalX, intent.goalY)) return undefined;
    if (intent.arriveThreshold !== undefined
      && (!Number.isFinite(intent.arriveThreshold) || intent.arriveThreshold < 0)) {
      return undefined;
    }
    if (intent.goalId !== undefined && !validIntentId(intent.goalId)) return undefined;
    return {
      mode: 'goal',
      goalX: intent.goalX,
      goalY: intent.goalY,
      ...(intent.goalId !== undefined ? { goalId: intent.goalId } : {}),
      ...(intent.arriveThreshold !== undefined
        ? { arriveThreshold: intent.arriveThreshold }
        : {}),
    };
  }

  if (!Number.isInteger(intent.targetId) || intent.targetId < 0
    || !finitePoint(intent.targetX, intent.targetY)
    || !Number.isFinite(intent.hardMinimumRange) || intent.hardMinimumRange < 0
    || !Number.isFinite(intent.preferredMinimumRange)
    || !Number.isFinite(intent.preferredMaximumRange)
    || intent.hardMinimumRange > intent.preferredMinimumRange
    || intent.preferredMinimumRange > intent.preferredMaximumRange) {
    return undefined;
  }
  return { ...intent };
}

export function cloneDodgeMovementIntent(
  intent: DodgeMovementIntent | null | undefined,
): DodgeMovementIntent | null {
  return intent ? { ...intent } : null;
}

function finitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function validIntentId(id: DodgeMovementIntentId): boolean {
  return typeof id === 'string' ? id.length > 0 : Number.isFinite(id);
}
