import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  getAssistantBlockSpacing,
  getGapBetweenStreamItems,
  isSameAssistantBlockGroup,
  isToolSequenceItem,
} from "./spacing";
import { SPACING } from "@/styles/theme";

function assistantBlock(params: {
  id: string;
  blockGroupId: string;
  blockIndex: number;
  text?: string;
}): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id: params.id,
    blockGroupId: params.blockGroupId,
    blockIndex: params.blockIndex,
    text: params.text ?? "",
    timestamp: new Date("2026-05-01T00:00:00.000Z"),
  };
}

function toolCallBlock(id: string): Extract<StreamItem, { kind: "tool_call" }> {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date("2026-05-01T00:00:00.000Z"),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "bash",
        arguments: "cmd",
        result: null,
        status: "executing",
      },
    },
  };
}

function pluginItem(
  id: string,
  sourceKind?: Extract<StreamItem, { kind: "plugin" }>["sourceKind"],
): Extract<StreamItem, { kind: "plugin" }> {
  return {
    kind: "plugin",
    id,
    timestamp: new Date("2026-05-01T00:00:00.000Z"),
    pluginId: "tools",
    pluginItemId: id,
    itemKind: "tool",
    version: 1,
    data: null,
    ...(sourceKind ? { sourceKind } : {}),
  };
}

function userMessage(id: string): Extract<StreamItem, { kind: "user_message" }> {
  return { kind: "user_message", id, text: id, timestamp: new Date("2026-05-01T00:00:00.000Z") };
}

describe("tool sequence spacing for plugin items", () => {
  it.each(["tool_call", "thought", "todo_list"] as const)(
    "treats a plugin item projected from %s as part of the tool sequence",
    (sourceKind) => {
      expect(isToolSequenceItem(pluginItem("p", sourceKind))).toBe(true);
    },
  );

  it.each(["assistant_message", "user_message", "notification", "compaction"] as const)(
    "does not treat a plugin item projected from %s as part of the tool sequence",
    (sourceKind) => {
      expect(isToolSequenceItem(pluginItem("p", sourceKind))).toBe(false);
    },
  );

  it("does not treat a plugin item without a source kind as part of the tool sequence", () => {
    expect(isToolSequenceItem(pluginItem("p"))).toBe(false);
  });

  it("stacks consecutive plugin tool rows with no gap", () => {
    expect(
      getGapBetweenStreamItems(pluginItem("a", "tool_call"), pluginItem("b", "tool_call")),
    ).toBe(0);
    expect(getGapBetweenStreamItems(pluginItem("a", "thought"), pluginItem("b", "todo_list"))).toBe(
      0,
    );
  });

  it("stacks plugin tool rows with native tool rows in either order", () => {
    expect(getGapBetweenStreamItems(pluginItem("a", "tool_call"), toolCallBlock("tc"))).toBe(0);
    expect(getGapBetweenStreamItems(toolCallBlock("tc"), pluginItem("a", "tool_call"))).toBe(0);
  });

  it("spaces plugin tool rows from user and assistant rows like native tool rows", () => {
    const plugin = pluginItem("a", "tool_call");
    const assistant = assistantBlock({ id: "as", blockGroupId: "g", blockIndex: 0 });
    const user = userMessage("u");
    const native = toolCallBlock("tc");
    expect(getGapBetweenStreamItems(user, plugin)).toBe(getGapBetweenStreamItems(user, native));
    expect(getGapBetweenStreamItems(user, plugin)).toBe(SPACING[4]);
    expect(getGapBetweenStreamItems(assistant, plugin)).toBe(
      getGapBetweenStreamItems(assistant, native),
    );
    expect(getGapBetweenStreamItems(plugin, assistant)).toBe(
      getGapBetweenStreamItems(native, assistant),
    );
  });

  it("keeps the default gap for plugin rows that are not tool-like", () => {
    expect(
      getGapBetweenStreamItems(pluginItem("a", "assistant_message"), pluginItem("b", "tool_call")),
    ).toBe(SPACING[4]);
  });
});

describe("isSameAssistantBlockGroup", () => {
  it("returns true for two assistant blocks with the same blockGroupId", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    const b = assistantBlock({ id: "b", blockGroupId: "group-1", blockIndex: 1 });
    expect(isSameAssistantBlockGroup({ item: a, other: b })).toBe(true);
  });

  it("returns false for blocks from different groups", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    const b = assistantBlock({ id: "b", blockGroupId: "group-2", blockIndex: 0 });
    expect(isSameAssistantBlockGroup({ item: a, other: b })).toBe(false);
  });

  it("returns false when one item is not an assistant_message", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    const tc = toolCallBlock("tc-1");
    expect(isSameAssistantBlockGroup({ item: a, other: tc })).toBe(false);
  });

  it("returns false for null neighbors", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    expect(isSameAssistantBlockGroup({ item: a, other: null })).toBe(false);
  });
});

describe("getAssistantBlockSpacing", () => {
  it("returns default for non-assistant items", () => {
    const tc = toolCallBlock("tc-1");
    expect(getAssistantBlockSpacing({ item: tc, aboveItem: null, belowItem: null })).toBe(
      "default",
    );
  });

  it("returns default when no same-group neighbors exist", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    expect(getAssistantBlockSpacing({ item: a, aboveItem: null, belowItem: null })).toBe("default");
  });

  it("compacts the bottom edge when the turn footer follows the assistant block", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    expect(
      getAssistantBlockSpacing({
        item: a,
        aboveItem: null,
        belowItem: null,
        hasFooterBelow: true,
      }),
    ).toBe("compactBottom");
  });

  it("returns compactTop when the item above is in the same block group", () => {
    const above = assistantBlock({ id: "above", blockGroupId: "group-1", blockIndex: 0 });
    const item = assistantBlock({ id: "item", blockGroupId: "group-1", blockIndex: 1 });
    expect(getAssistantBlockSpacing({ item, aboveItem: above, belowItem: null })).toBe(
      "compactTop",
    );
  });

  it("returns compactBottom when the item below is in the same block group", () => {
    const item = assistantBlock({ id: "item", blockGroupId: "group-1", blockIndex: 0 });
    const below = assistantBlock({ id: "below", blockGroupId: "group-1", blockIndex: 1 });
    expect(getAssistantBlockSpacing({ item, aboveItem: null, belowItem: below })).toBe(
      "compactBottom",
    );
  });

  it("returns compactBoth when both neighbors are in the same block group", () => {
    const above = assistantBlock({ id: "above", blockGroupId: "group-1", blockIndex: 0 });
    const item = assistantBlock({ id: "item", blockGroupId: "group-1", blockIndex: 1 });
    const below = assistantBlock({ id: "below", blockGroupId: "group-1", blockIndex: 2 });
    expect(getAssistantBlockSpacing({ item, aboveItem: above, belowItem: below })).toBe(
      "compactBoth",
    );
  });

  it("spans the history/live-head boundary: tail gets compactBottom, head gets compactTop", () => {
    const tailBlock = assistantBlock({
      id: "group-1:block:0",
      blockGroupId: "group-1",
      blockIndex: 0,
      text: "First paragraph",
    });
    const headBlock = assistantBlock({
      id: "group-1:head",
      blockGroupId: "group-1",
      blockIndex: 1,
      text: "Second paragraph",
    });

    expect(
      getAssistantBlockSpacing({ item: tailBlock, aboveItem: null, belowItem: headBlock }),
    ).toBe("compactBottom");
    expect(
      getAssistantBlockSpacing({ item: headBlock, aboveItem: tailBlock, belowItem: null }),
    ).toBe("compactTop");
  });
});
