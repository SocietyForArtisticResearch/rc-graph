const defaultGraphState = createGraphState();

async function loadGraphState() {
  const result = await browser.storage.local.get("graphState");
  return ensureCanonicalGraphState(result.graphState ?? defaultGraphState);
}

async function saveGraphState(graphState) {
  await browser.storage.local.set({ graphState });
}

function withPendingSelection(graphState, pendingSelection) {
  return {
    ...graphState,
    pendingSelection
  };
}

function ensureGraphState(state) {
  return ensureCanonicalGraphState(state ?? createGraphState());
}

browser.runtime.onInstalled.addListener(async () => {
  const currentState = await loadGraphState();
  await saveGraphState(currentState);
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "graph:get") {
    return loadGraphState();
  }

  if (message?.type === "graph:save") {
    return saveGraphState(message.graphState);
  }

  if (message?.type === "graph:select-tool") {
    const graphState = ensureGraphState(await loadGraphState());
    const node = message.node;
    const existingPendingSelection = graphState.pendingSelection;

    mergeNode(graphState, node);

    if (!existingPendingSelection) {
      const nextState = withPendingSelection(graphState, node);
      await saveGraphState(nextState);
      return {
        ...nextState,
        status: "pending-source"
      };
    }

    if (existingPendingSelection.key === node.key) {
      await saveGraphState(withPendingSelection(graphState, existingPendingSelection));
      return {
        ...graphState,
        pendingSelection: existingPendingSelection,
        status: "same-node"
      };
    }

    const nextState = {
      ...graphState,
      pendingSelection: existingPendingSelection,
      selectedTarget: node,
      status: "awaiting-relation-type"
    };

    await saveGraphState(nextState);
    return nextState;
  }

  if (message?.type === "graph:complete-edge") {
    const graphState = ensureGraphState(await loadGraphState());
    const source = graphState.pendingSelection;
    const target = message.targetNode;
    const relationType = String(message.relationType || "").trim();
    const relationTypeOrigin = String(message.relationTypeOrigin || "custom").trim();

    if (!source || !target || !relationType) {
      return {
        ...graphState,
        status: "missing-data"
      };
    }

    mergeNode(graphState, source);
    mergeNode(graphState, target);

    const edge = createEdge({
      sourceKey: source.key,
      targetKey: target.key,
      relationType,
      metadata: {
        sourcePageUrl: source.pageUrl,
        sourceCanonicalUrl: source.canonicalUrl || source.key,
        targetPageUrl: target.pageUrl,
        targetCanonicalUrl: target.canonicalUrl || target.key,
        relationTypeOrigin
      }
    });

    if (relationTypeOrigin === "custom") {
      addRelationPreset(graphState, relationType);
    }

    graphState.edges.push(edge);

    const nextState = {
      ...graphState,
      pendingSelection: null,
      selectedTarget: null,
      status: "edge-stored"
    };

    await saveGraphState(nextState);
    return nextState;
  }

  if (message?.type === "graph:update-edge") {
    const graphState = ensureGraphState(await loadGraphState());
    const edgeId = String(message.edgeId || "").trim();
    const updates = message.updates || {};
    const edgeIndex = graphState.edges.findIndex((edge) => edge.edgeId === edgeId);

    if (edgeIndex === -1) {
      return {
        ...graphState,
        status: "edge-not-found"
      };
    }

    const existingEdge = graphState.edges[edgeIndex];
    graphState.edges[edgeIndex] = {
      ...existingEdge,
      relationType: typeof updates.relationType === "string" ? updates.relationType.trim() || existingEdge.relationType : existingEdge.relationType,
      note: typeof updates.note === "string" ? updates.note : existingEdge.note,
      metadata: {
        ...existingEdge.metadata,
        ...(updates.metadata || {})
      }
    };

    if (typeof updates.relationType === "string") {
      const updatedRelationType = updates.relationType.trim();

      if (updatedRelationType && !graphState.relationPresets.includes(updatedRelationType)) {
        addRelationPreset(graphState, updatedRelationType);
      }
    }

    const nextState = {
      ...graphState,
      status: "edge-updated"
    };

    await saveGraphState(nextState);
    return nextState;
  }

  if (message?.type === "graph:delete-edge") {
    const graphState = ensureGraphState(await loadGraphState());
    const edgeId = String(message.edgeId || "").trim();
    const nextEdges = graphState.edges.filter((edge) => edge.edgeId !== edgeId);

    if (nextEdges.length === graphState.edges.length) {
      return {
        ...graphState,
        status: "edge-not-found"
      };
    }

    const nextState = {
      ...graphState,
      edges: nextEdges,
      status: "edge-deleted"
    };

    await saveGraphState(nextState);
    return nextState;
  }

  return undefined;
});