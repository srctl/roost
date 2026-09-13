import type { AgentNavigation, NavigationChange } from "./navigation-schema";

// The server and optimistic UI use the same placement rules. Agents newly
// created by another request are appended by the loader's creation-order fallback.
export function placeAgent(
  order: readonly string[],
  memberships: Record<string, string>,
  agentId: string,
  sectionId: string | null,
  beforeAgentId: string | null,
) {
  const next = order.filter((id) => id !== agentId);
  const before = beforeAgentId === null ? -1 : next.indexOf(beforeAgentId);
  const last = next.reduce(
    (found, id, index) =>
      (memberships[id] ?? null) === sectionId ? index : found,
    -1,
  );
  next.splice(
    before >= 0 ? before : last >= 0 ? last + 1 : next.length,
    0,
    agentId,
  );
  return next;
}

export function orderAgents<A extends { id: string }>(
  agents: readonly A[],
  order: readonly string[],
) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...agents].sort(
    (a, b) =>
      (positions.get(a.id) ?? order.length) -
      (positions.get(b.id) ?? order.length),
  );
}

export function orderedSections(navigation: AgentNavigation) {
  const groups = [...navigation.sections];
  groups.splice(navigation.ungroupedPosition, 0, {
    id: "",
    name: "Ungrouped",
    collapsed: false,
    position: navigation.ungroupedPosition,
  });
  return groups;
}

export function moveSection(
  navigation: AgentNavigation,
  id: string | null,
  direction: "up" | "down",
): AgentNavigation {
  const groups = orderedSections(navigation);
  const index = groups.findIndex((group) => group.id === (id ?? ""));
  const next = index + (direction === "up" ? -1 : 1);
  if (index < 0 || next < 0 || next >= groups.length) return navigation;
  [groups[index], groups[next]] = [groups[next]!, groups[index]!];
  return {
    ...navigation,
    sections: groups
      .map((group, position) => ({ ...group, position }))
      .filter((group) => group.id !== ""),
    ungroupedPosition: groups.findIndex((group) => group.id === ""),
  };
}

export function placeSection(
  navigation: AgentNavigation,
  id: string | null,
  targetId: string | null,
  edge: "before" | "after",
): AgentNavigation {
  if (id === targetId) return navigation;
  const groups = orderedSections(navigation);
  const source = groups.find((group) => group.id === (id ?? ""));
  if (!source) return navigation;
  const remaining = groups.filter((group) => group !== source);
  const target = remaining.findIndex((group) => group.id === (targetId ?? ""));
  if (target < 0) return navigation;
  remaining.splice(target + (edge === "after" ? 1 : 0), 0, source);
  return {
    ...navigation,
    sections: remaining
      .map((group, position) => ({ ...group, position }))
      .filter((group) => group.id !== ""),
    ungroupedPosition: remaining.findIndex((group) => group.id === ""),
  };
}

export function applyNavigationChange(
  navigation: AgentNavigation,
  change: NavigationChange,
): AgentNavigation {
  const { sections, memberships } = navigation;
  switch (change.action) {
    case "place-section":
      return placeSection(navigation, change.id, change.targetId, change.edge);
    case "reorder-section":
      return moveSection(navigation, change.id, change.direction);
    case "create":
      return {
        ...navigation,
        ungroupedPosition:
          navigation.ungroupedPosition === sections.length
            ? sections.length + 1
            : navigation.ungroupedPosition,
        sections: [
          ...sections,
          {
            id: change.id,
            name: change.name,
            collapsed: false,
            position:
              sections.length === navigation.ungroupedPosition
                ? sections.length
                : sections.length + 1,
          },
        ],
      };
    case "rename":
    case "collapse":
      return {
        ...navigation,
        sections: sections.map((section) =>
          section.id !== change.id
            ? section
            : {
                ...section,
                ...(change.action === "rename"
                  ? { name: change.name }
                  : { collapsed: change.collapsed }),
              },
        ),
      };
    case "delete": {
      const removed = sections.find((section) => section.id === change.id);
      if (!removed) return navigation;
      return {
        ...navigation,
        sections: sections
          .filter((section) => section.id !== change.id)
          .map((section) => ({
            ...section,
            position:
              section.position > removed.position
                ? section.position - 1
                : section.position,
          })),
        ungroupedPosition:
          navigation.ungroupedPosition > removed.position
            ? navigation.ungroupedPosition - 1
            : navigation.ungroupedPosition,
        memberships: Object.fromEntries(
          Object.entries(memberships).filter(([, id]) => id !== change.id),
        ),
      };
    }
    case "move": {
      const next = { ...memberships };
      if (change.sectionId === null) delete next[change.agentId];
      else next[change.agentId] = change.sectionId;
      return {
        ...navigation,
        sections,
        memberships: next,
        agentOrder: placeAgent(
          navigation.agentOrder,
          next,
          change.agentId,
          change.sectionId,
          change.beforeAgentId ?? null,
        ),
      };
    }
  }
}

// Serialize writes so rapid toggles cannot persist in the wrong order. Render
// all queued changes immediately; a failed write rolls back only that change.
export function createNavigationState(
  initial: AgentNavigation,
  persist: (change: NavigationChange) => Promise<void>,
) {
  let confirmed = initial;
  let snapshot = { navigation: initial, busy: false, error: "" };
  const listeners = new Set<() => void>();
  const pending: {
    change: NavigationChange;
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  function publish(error = snapshot.error) {
    snapshot = {
      navigation: pending.reduce(
        (navigation, entry) => applyNavigationChange(navigation, entry.change),
        confirmed,
      ),
      busy: pending.some(
        ({ change }) =>
          change.action !== "collapse" &&
          change.action !== "reorder-section" &&
          change.action !== "place-section",
      ),
      error,
    };
    for (const listener of listeners) listener();
  }
  async function flush() {
    while (pending.length) {
      const entry = pending[0]!;
      try {
        await persist(entry.change);
        confirmed = applyNavigationChange(confirmed, entry.change);
        pending.shift();
        publish();
        entry.resolve();
      } catch (cause) {
        const error =
          cause instanceof Error
            ? cause
            : new Error("Could not save sections. Try again.");
        pending.shift();
        publish(error.message);
        entry.reject(error);
      }
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync(navigation: AgentNavigation) {
      if (pending.length) return;
      confirmed = navigation;
      publish();
    },
    save(change: NavigationChange) {
      return new Promise<void>((resolve, reject) => {
        pending.push({ change, resolve, reject });
        publish("");
        if (pending.length === 1) void flush();
      });
    },
  };
}
