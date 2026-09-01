import type { BotInstance } from "types/bot-instances";
import type { BotGroup } from "types/bot-groups";
import type { PlanGuardViolation } from "types/plan-guard";
import { getInstanceForUser } from "lib/bot-instances";
import { getGroupByIdForUser, getGroupForInstanceByRemoteId } from "lib/bot-groups";
import { evaluatePlanGuard } from "lib/plan-guard";

const GUARD_CACHE_TTL_MS = 15_000;
const GUARD_CACHE_MAX_ENTRIES = 500;

type GuardCacheEntry = {
  expiresAt: number;
  violation: PlanGuardViolation | null;
};

export type BotAutomationGuardDecision = {
  blocked: boolean;
  violation: PlanGuardViolation | null;
  reason?: "missing_instance" | "missing_group" | "group_disabled" | "evaluation_error";
};

const guardCache = new Map<string, GuardCacheEntry>();

const pruneGuardCache = (now = Date.now()) => {
  for (const [key, entry] of guardCache.entries()) {
    if (entry.expiresAt <= now) {
      guardCache.delete(key);
    }
  }

  while (guardCache.size > GUARD_CACHE_MAX_ENTRIES) {
    const oldestKey = guardCache.keys().next().value;
    if (!oldestKey) break;
    guardCache.delete(oldestKey);
  }
};

export const evaluateBotAutomationGuard = async (params: {
  userId: number;
  instance: BotInstance;
  group?: BotGroup | null;
  cacheTtlMs?: number;
}): Promise<PlanGuardViolation | null> => {
  const groupId = params.group?.id ?? 0;
  const cacheKey = `${params.userId}:${params.instance.id}:${groupId}`;
  const now = Date.now();
  const cached = guardCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.violation;
  }

  pruneGuardCache(now);
  const violation = await evaluatePlanGuard({
    userId: params.userId,
    instance: params.instance,
    group: params.group ?? null,
  });

  guardCache.set(cacheKey, {
    expiresAt: now + Math.max(1_000, params.cacheTtlMs ?? GUARD_CACHE_TTL_MS),
    violation,
  });

  return violation;
};

export const resolveBotAutomationGuard = async (params: {
  userId: number;
  instanceId: number;
  groupId?: number | null;
  groupRemoteId?: string | null;
}): Promise<BotAutomationGuardDecision> => {
  try {
    const instance = await getInstanceForUser(params.userId, params.instanceId);
    if (!instance) {
      return { blocked: true, violation: null, reason: "missing_instance" };
    }

    let group: BotGroup | null = null;
    if (params.groupId) {
      group = await getGroupByIdForUser(params.userId, params.groupId);
    } else if (params.groupRemoteId) {
      group = await getGroupForInstanceByRemoteId(params.instanceId, params.groupRemoteId);
    }

    if ((params.groupId || params.groupRemoteId) && !group) {
      return { blocked: true, violation: null, reason: "missing_group" };
    }
    if (group && group.userId !== params.userId) {
      return { blocked: true, violation: null, reason: "missing_group" };
    }
    if (group && group.status !== "active") {
      return { blocked: true, violation: null, reason: "group_disabled" };
    }

    const violation = await evaluateBotAutomationGuard({
      userId: params.userId,
      instance,
      group,
    });

    return { blocked: Boolean(violation), violation };
  } catch (error) {
    console.error("[bot-automation-guard] Falha ao avaliar bloqueio de automação", {
      userId: params.userId,
      instanceId: params.instanceId,
      groupId: params.groupId ?? null,
      groupRemoteId: params.groupRemoteId ?? null,
      error,
    });
    return { blocked: true, violation: null, reason: "evaluation_error" };
  }
};
