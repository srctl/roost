import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AgentNavigation,
  NavigationChange,
} from "../src/features/agents/navigation-schema";
import {
  createNavigationState,
  orderedSections,
  placeSection,
} from "../src/features/agents/navigation-state";

const initial: AgentNavigation = {
  sections: [
    { id: "travel", name: "Travel", position: 0, collapsed: false },
    { id: "work", name: "Work", position: 1, collapsed: false },
  ],
  memberships: { mexico: "travel" },
  agentOrder: ["mexico", "other", "third"],
  ungroupedPosition: 2,
};
function fixture() {
  const requests: {
    change: NavigationChange;
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  const state = createNavigationState(
    initial,
    (change) =>
      new Promise<void>((resolve, reject) =>
        requests.push({ change, resolve, reject }),
      ),
  );
  return { state, requests };
}

test("section drops place Ungrouped at either end and named sections around it", () => {
  const ids = (navigation: AgentNavigation) =>
    orderedSections(navigation).map((section) => section.id);
  const first = placeSection(initial, null, "travel", "before");
  assert.deepEqual(ids(first), ["", "travel", "work"]);
  const last = placeSection(first, null, "work", "after");
  assert.deepEqual(ids(last), ["travel", "work", ""]);
  const middle = placeSection(last, "travel", null, "before");
  assert.deepEqual(ids(middle), ["work", "travel", ""]);
  assert.deepEqual(ids(placeSection(middle, "travel", null, "after")), [
    "work",
    "",
    "travel",
  ]);
  assert.equal(placeSection(initial, null, null, "before"), initial);
  assert.equal(placeSection(initial, "missing", null, "after"), initial);
  assert.deepEqual(middle.memberships, initial.memberships);
  assert.deepEqual(middle.agentOrder, initial.agentOrder);
});

test("failed section drag rolls back while a later drop still applies", async () => {
  const { state, requests } = fixture();
  const first = state.save({
    action: "place-section",
    id: null,
    targetId: "travel",
    edge: "before",
  });
  const rejected = assert.rejects(first, /Offline/);
  const second = state.save({
    action: "place-section",
    id: "travel",
    targetId: "work",
    edge: "after",
  });
  assert.equal(state.getSnapshot().busy, false);
  requests[0]!.reject(new Error("Offline"));
  await rejected;
  assert.deepEqual(
    orderedSections(state.getSnapshot().navigation).map(
      (section) => section.id,
    ),
    ["work", "travel", ""],
  );
  requests[1]!.resolve();
  await second;
});

test("rapid toggles render immediately, persist sequentially and ignore stale loader data while saving", async () => {
  const { state, requests } = fixture();
  const first = state.save({
    action: "collapse",
    id: "travel",
    collapsed: true,
  });
  assert.equal(state.getSnapshot().navigation.sections[0]?.collapsed, true);
  assert.equal(state.getSnapshot().busy, false);
  const second = state.save({
    action: "collapse",
    id: "travel",
    collapsed: false,
  });
  const third = state.save({ action: "collapse", id: "work", collapsed: true });
  assert.equal(state.getSnapshot().navigation.sections[0]?.collapsed, false);
  assert.equal(state.getSnapshot().navigation.sections[1]?.collapsed, true);
  state.sync(initial);
  assert.equal(state.getSnapshot().navigation.sections[1]?.collapsed, true);
  assert.equal(requests.length, 1);
  requests[0]!.resolve();
  await first;
  assert.equal(requests.length, 2);
  assert.equal(state.getSnapshot().navigation.sections[0]?.collapsed, false);
  requests[1]!.resolve();
  await second;
  requests[2]!.resolve();
  await third;
  assert.equal(state.getSnapshot().navigation.sections[0]?.collapsed, false);
  assert.equal(state.getSnapshot().navigation.sections[1]?.collapsed, true);
});

test("a rejected toggle rolls back without losing a newer toggle or changes to other sections", async () => {
  const { state, requests } = fixture();
  const first = state.save({
    action: "collapse",
    id: "travel",
    collapsed: true,
  });
  const rejected = assert.rejects(first, /Offline/);
  const second = state.save({
    action: "collapse",
    id: "travel",
    collapsed: false,
  });
  const third = state.save({ action: "collapse", id: "work", collapsed: true });
  requests[0]!.reject(new Error("Offline"));
  await rejected;
  assert.equal(state.getSnapshot().navigation.sections[0]?.collapsed, false);
  assert.equal(state.getSnapshot().navigation.sections[1]?.collapsed, true);
  assert.equal(state.getSnapshot().error, "Offline");
  requests[1]!.resolve();
  await second;
  requests[2]!.resolve();
  await third;
});

test("failed removal restores the section and memberships; retry can remove it", async () => {
  const { state, requests } = fixture();
  const removed = state.save({ action: "delete", id: "travel" });
  const rejected = assert.rejects(removed, /Offline/);
  assert.equal(state.getSnapshot().navigation.sections.length, 1);
  assert.deepEqual(state.getSnapshot().navigation.memberships, {});
  assert.equal(state.getSnapshot().busy, true);
  requests[0]!.reject(new Error("Offline"));
  await rejected;
  assert.deepEqual(state.getSnapshot().navigation, initial);
  assert.equal(state.getSnapshot().busy, false);
  const retry = state.save({ action: "delete", id: "travel" });
  requests[1]!.resolve();
  await retry;
  assert.equal(state.getSnapshot().error, "");
  assert.equal(state.getSnapshot().navigation.sections.length, 1);
  assert.deepEqual(state.getSnapshot().navigation.memberships, {});
});

test("moving an agent updates membership immediately and restores it after a failed save", async () => {
  const { state, requests } = fixture();
  const moved = state.save({
    action: "move",
    agentId: "mexico",
    sectionId: "work",
  });
  const rejected = assert.rejects(moved, /Offline/);
  assert.equal(state.getSnapshot().navigation.memberships.mexico, "work");
  requests[0]!.reject(new Error("Offline"));
  await rejected;
  assert.equal(state.getSnapshot().navigation.memberships.mexico, "travel");
  const ungrouped = state.save({
    action: "move",
    agentId: "mexico",
    sectionId: null,
  });
  assert.equal(state.getSnapshot().navigation.memberships.mexico, undefined);
  requests[1]!.resolve();
  await ungrouped;
  assert.equal(state.getSnapshot().navigation.memberships.mexico, undefined);
});

test("reordering is immediate and a failed reorder preserves a newer placement", async () => {
  const { state, requests } = fixture();
  const first = state.save({
    action: "move",
    agentId: "third",
    sectionId: null,
    beforeAgentId: "other",
  });
  const rejected = assert.rejects(first, /Offline/);
  assert.deepEqual(state.getSnapshot().navigation.agentOrder, [
    "mexico",
    "third",
    "other",
  ]);
  const second = state.save({
    action: "move",
    agentId: "mexico",
    sectionId: null,
    beforeAgentId: "third",
  });
  assert.deepEqual(state.getSnapshot().navigation.agentOrder, [
    "mexico",
    "third",
    "other",
  ]);
  requests[0]!.reject(new Error("Offline"));
  await rejected;
  assert.deepEqual(state.getSnapshot().navigation.agentOrder, [
    "other",
    "mexico",
    "third",
  ]);
  requests[1]!.resolve();
  await second;
  assert.deepEqual(state.getSnapshot().navigation.agentOrder, [
    "other",
    "mexico",
    "third",
  ]);
});

test("Ungrouped reorders immediately and failed steps preserve later section moves", async () => {
  const { state, requests } = fixture();
  const first = state.save({
    action: "reorder-section",
    id: null,
    direction: "up",
  });
  const rejected = assert.rejects(first, /Offline/);
  assert.equal(state.getSnapshot().navigation.ungroupedPosition, 1);
  assert.equal(state.getSnapshot().busy, false);
  const second = state.save({
    action: "reorder-section",
    id: "work",
    direction: "up",
  });
  requests[0]!.reject(new Error("Offline"));
  await rejected;
  assert.deepEqual(
    state.getSnapshot().navigation.sections.map((section) => section.id),
    ["work", "travel"],
  );
  assert.equal(state.getSnapshot().navigation.ungroupedPosition, 2);
  requests[1]!.resolve();
  await second;
  assert.deepEqual(
    state.getSnapshot().navigation.memberships,
    initial.memberships,
  );
  assert.deepEqual(
    state.getSnapshot().navigation.agentOrder,
    initial.agentOrder,
  );
});
