const DEFAULT_RELATION_PRESETS = [
  "related_to",
  "references",
  "inspired_by",
  "part_of",
  "supports",
  "extends",
  "compares_with",
  "comments_on"
];

function normalizePageUrl(url) {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.hash = "";
    return parsedUrl.href;
  } catch {
    return url;
  }
}

function makeCanonicalToolUrl(pageUrl, toolId) {
  return `${normalizePageUrl(pageUrl)}#tool-${String(toolId)}`;
}

function normalizeRelationTypeValue(value) {
  return String(value || "").trim();
}

function ensureRelationPresets(existingPresets) {
  const seen = new Set();
  const presets = [];

  for (const preset of DEFAULT_RELATION_PRESETS) {
    const normalizedPreset = normalizeRelationTypeValue(preset);

    if (normalizedPreset && !seen.has(normalizedPreset)) {
      seen.add(normalizedPreset);
      presets.push(normalizedPreset);
    }
  }

  for (const preset of existingPresets || []) {
    const normalizedPreset = normalizeRelationTypeValue(preset);

    if (normalizedPreset && !seen.has(normalizedPreset)) {
      seen.add(normalizedPreset);
      presets.push(normalizedPreset);
    }
  }

  return presets;
}

function addRelationPreset(graphState, relationType) {
  const normalizedRelationType = normalizeRelationTypeValue(relationType);

  if (!normalizedRelationType) {
    return graphState;
  }

  graphState.relationPresets = ensureRelationPresets(graphState.relationPresets);

  if (!graphState.relationPresets.includes(normalizedRelationType)) {
    graphState.relationPresets.push(normalizedRelationType);
  }

  return graphState;
}

function makeNodeKey(pageUrl, toolId) {
  return makeCanonicalToolUrl(pageUrl, toolId);
}

function createToolNode({ pageUrl, toolId, toolType, label = "", metadata = {} }) {
  const normalizedPageUrl = normalizePageUrl(pageUrl);
  const canonicalUrl = makeCanonicalToolUrl(normalizedPageUrl, toolId);

  return {
    key: canonicalUrl,
    pageUrl: normalizedPageUrl,
    toolId: String(toolId),
    canonicalUrl,
    toolType,
    label,
    metadata
  };
}

function normalizeToolNode(node) {
  const normalizedPageUrl = normalizePageUrl(node.pageUrl || node.metadata?.sourcePageUrl || "");
  const toolId = String(node.toolId || "");
  const canonicalUrl = makeCanonicalToolUrl(normalizedPageUrl, toolId);

  return {
    ...node,
    pageUrl: normalizedPageUrl,
    toolId,
    canonicalUrl,
    key: canonicalUrl
  };
}

function readToolNodeFromElement(element) {
  const pageUrl = element.ownerDocument?.location?.href ?? "";
  const toolId = element.dataset.id ?? element.getAttribute("data-id") ?? "";
  const toolType = element.dataset.tool ?? element.getAttribute("data-tool") ?? "";
  const label = (element.textContent || "").replace(/\s+/g, " ").trim();

  return createToolNode({
    pageUrl,
    toolId,
    toolType,
    label,
    metadata: {
      className: element.className,
      textModified: element.dataset.textModified ?? null,
      lastModifiedAt: element.dataset.lastModifiedAt ?? null,
      lastModifiedBy: element.dataset.lastModifiedBy ?? null
    }
  });
}

function createEdge({ sourceKey, targetKey, relationType, note = "", metadata = {} }) {
  return {
    edgeId: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    sourceKey,
    targetKey,
    relationType,
    note,
    metadata,
    createdAt: new Date().toISOString()
  };
}

function ensureEdgeIds(graphState) {
  graphState.edges = (graphState.edges || []).map((edge) => {
    if (edge.edgeId) {
      return edge;
    }

    return {
      ...edge,
      edgeId: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    };
  });

  return graphState;
}

function ensureCanonicalGraphState(graphState) {
  const normalizedState = {
    ...graphState,
    nodes: [],
    edges: []
  };
  const keyMap = new Map();

  for (const node of graphState.nodes || []) {
    const normalizedNode = normalizeToolNode(node);
    keyMap.set(node.key, normalizedNode.key);
    normalizedState.nodes.push(normalizedNode);
  }

  for (const edge of graphState.edges || []) {
    const normalizedEdge = {
      ...edge,
      edgeId: edge.edgeId || `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      sourceKey: keyMap.get(edge.sourceKey) || edge.sourceKey,
      targetKey: keyMap.get(edge.targetKey) || edge.targetKey,
      metadata: {
        ...edge.metadata,
        sourceCanonicalUrl: keyMap.get(edge.sourceKey) || edge.metadata?.sourceCanonicalUrl || edge.sourceKey,
        targetCanonicalUrl: keyMap.get(edge.targetKey) || edge.metadata?.targetCanonicalUrl || edge.targetKey
      }
    };

    normalizedState.edges.push(normalizedEdge);
  }

  if (graphState.pendingSelection) {
    normalizedState.pendingSelection = normalizeToolNode(graphState.pendingSelection);
  }

  if (graphState.selectedTarget) {
    normalizedState.selectedTarget = normalizeToolNode(graphState.selectedTarget);
  }

  normalizedState.relationPresets = ensureRelationPresets(graphState.relationPresets);

  return ensureEdgeIds(normalizedState);
}

function createGraphState() {
  return {
    nodes: [],
    edges: [],
    pendingSelection: null,
    relationPresets: [...DEFAULT_RELATION_PRESETS],
    extensionEnabled: true
  };
}

function mergeNode(graphState, node) {
  const existingIndex = graphState.nodes.findIndex((candidate) => candidate.key === node.key);

  if (existingIndex === -1) {
    graphState.nodes.push(node);
    return node;
  }

  graphState.nodes[existingIndex] = {
    ...graphState.nodes[existingIndex],
    ...node,
    metadata: {
      ...graphState.nodes[existingIndex].metadata,
      ...node.metadata
    }
  };

  return graphState.nodes[existingIndex];
}

function escapeCypherString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n");
}

function sanitizeRelationshipType(relationType) {
  const cleaned = String(relationType || "related_to")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned || "RELATED_TO";
}

function buildCypherExport(graphState) {
  const nodesByKey = new Map((graphState.nodes || []).map((node) => [node.key, node]));

  const nodeStatements = graphState.nodes.map((node) => {
    const properties = [
      `key: '${escapeCypherString(node.key)}'`,
      `pageUrl: '${escapeCypherString(node.pageUrl)}'`,
      `toolId: '${escapeCypherString(node.toolId)}'`,
      `canonicalUrl: '${escapeCypherString(node.canonicalUrl || node.key)}'`,
      `toolType: '${escapeCypherString(node.toolType)}'`,
      `label: '${escapeCypherString(node.label)}'`
    ].join(", ");

    return `MERGE (n:Tool { key: '${escapeCypherString(node.key)}' }) SET n += { ${properties} };`;
  });

  const edgeStatements = graphState.edges.map((edge) => {
    const relationType = sanitizeRelationshipType(edge.relationType);
    const sourceNode = nodesByKey.get(edge.sourceKey);
    const targetNode = nodesByKey.get(edge.targetKey);
    const sourcePageUrl = edge.metadata?.sourcePageUrl || sourceNode?.pageUrl || "";
    const targetPageUrl = edge.metadata?.targetPageUrl || targetNode?.pageUrl || "";
    const sourceCanonicalUrl = edge.metadata?.sourceCanonicalUrl || sourceNode?.canonicalUrl || sourceNode?.key || edge.sourceKey;
    const targetCanonicalUrl = edge.metadata?.targetCanonicalUrl || targetNode?.canonicalUrl || targetNode?.key || edge.targetKey;
    const properties = [
      `edgeId: '${escapeCypherString(edge.edgeId || "")}'`,
      `relationType: '${escapeCypherString(edge.relationType)}'`,
      `note: '${escapeCypherString(edge.note || "")}'`,
      `createdAt: '${escapeCypherString(edge.createdAt)}'`,
      `sourcePageUrl: '${escapeCypherString(sourcePageUrl)}'`,
      `targetPageUrl: '${escapeCypherString(targetPageUrl)}'`,
      `sourceCanonicalUrl: '${escapeCypherString(sourceCanonicalUrl)}'`,
      `targetCanonicalUrl: '${escapeCypherString(targetCanonicalUrl)}'`,
      `relationTypeOrigin: '${escapeCypherString(edge.metadata?.relationTypeOrigin || "custom")}'`
    ].join(", ");

    return [
      `MATCH (source:Tool { key: '${escapeCypherString(edge.sourceKey)}' })`,
      `MATCH (target:Tool { key: '${escapeCypherString(edge.targetKey)}' })`,
      `MERGE (source)-[r:${relationType}]->(target)`,
      `SET r += { ${properties} };`
    ].join(" ");
    normalizedState.extensionEnabled = graphState.extensionEnabled !== false;
  });

  return [
    "// rcGraph export for Neo4j",
    ...nodeStatements,
    ...edgeStatements
  ].join("\n");
}