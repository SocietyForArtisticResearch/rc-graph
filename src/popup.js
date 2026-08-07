async function loadGraphStateFromBackground() {
  return browser.runtime.sendMessage({ type: "graph:get" });
}

async function setExtensionEnabled(enabled) {
  return browser.runtime.sendMessage({
    type: "graph:set-extension-enabled",
    enabled
  });
}

let currentEditEdgeId = null;

function groupEdgesByRelationType(edges) {
  const groups = new Map();

  for (const edge of edges || []) {
    const relationType = edge.relationType || "related_to";

    if (!groups.has(relationType)) {
      groups.set(relationType, []);
    }

    groups.get(relationType).push(edge);
  }

  return groups;
}

function renderEdge(edge, nodesByKey) {
  const source = nodesByKey.get(edge.sourceKey);
  const target = nodesByKey.get(edge.targetKey);
  const sourceCanonicalUrl = source?.canonicalUrl || source?.key || edge.sourceKey;
  const targetCanonicalUrl = target?.canonicalUrl || target?.key || edge.targetKey;
  const sourceLink = createLinkHtml(sourceCanonicalUrl);
  const targetLink = createLinkHtml(targetCanonicalUrl);

  return `
    <div class="edge" data-edge-id="${escapeHtml(edge.edgeId || "")}">
      <div class="edge-top">
        <div class="edge-type">${escapeHtml(edge.relationType)}</div>
        <div class="edge-meta">${escapeHtml(edge.metadata?.relationTypeOrigin || "custom")}</div>
      </div>
      <div class="edge-meta">
        ${escapeHtml(source?.label || source?.toolId || edge.sourceKey)} → ${escapeHtml(target?.label || target?.toolId || edge.targetKey)}
      </div>
      <div class="edge-meta">${sourceLink} to ${targetLink}</div>
      <div class="edge-meta">${escapeHtml(edge.note || "")}</div>
      <div class="actions">
        <button class="secondary" type="button" data-action="edit-edge" data-edge-id="${escapeHtml(edge.edgeId || "")}">Edit</button>
        <button class="secondary" type="button" data-action="delete-edge" data-edge-id="${escapeHtml(edge.edgeId || "")}">Delete</button>
      </div>
    </div>
  `;
}

function renderEdgeGroup(relationType, edges, nodesByKey) {
  return `
    <section class="edge-group">
      <h3 class="edge-group-title">${escapeHtml(relationType)}</h3>
      <div class="edge-group-count">${edges.length} relationship${edges.length === 1 ? "" : "s"}</div>
      <div class="edges">
        ${edges.map((edge) => renderEdge(edge, nodesByKey)).join("")}
      </div>
    </section>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createLinkHtml(url) {
  const safeUrl = String(url || "");

  if (!safeUrl) {
    return "";
  }

  return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${escapeHtml(safeUrl)}</a>`;
}

async function renderPopup() {
  const state = await loadGraphStateFromBackground();
  const nodesByKey = new Map((state.nodes || []).map((node) => [node.key, node]));
  const cypher = buildCypherExport(state);
  const extensionEnabled = state.extensionEnabled !== false;

  document.getElementById("node-count").textContent = String(state.nodes?.length || 0);
  document.getElementById("edge-count").textContent = String(state.edges?.length || 0);
  document.getElementById("pending-count").textContent = state.pendingSelection ? "1" : "0";

  const extensionToggle = document.getElementById("extension-enabled-toggle");
  const toggleTitle = document.getElementById("toggle-title");
  const toggleDescription = document.getElementById("toggle-description");

  extensionToggle.checked = extensionEnabled;
  toggleTitle.textContent = extensionEnabled ? "Extension enabled" : "Extension disabled";
  toggleDescription.textContent = extensionEnabled
    ? "Hold Shift to show the overlay and select tools."
    : "Enable the extension to select tools and add relationships.";

  const edgeList = document.getElementById("edge-list");
  if (!state.edges || state.edges.length === 0) {
    edgeList.innerHTML = '<div class="empty">No relationships saved yet.</div>';
  } else {
    const groupedEdges = groupEdgesByRelationType(state.edges);
    edgeList.innerHTML = Array.from(groupedEdges.entries())
      .map(([relationType, edges]) => renderEdgeGroup(relationType, edges, nodesByKey))
      .join("");
  }

  document.getElementById("cypher-output").value = cypher;

  if (currentEditEdgeId) {
    const currentEdge = (state.edges || []).find((edge) => edge.edgeId === currentEditEdgeId);
    if (currentEdge) {
      openEditor(currentEdge);
    } else {
      closeEditor();
    }
  }
}

async function copyCypher() {
  const cypherOutput = document.getElementById("cypher-output");
  await navigator.clipboard.writeText(cypherOutput.value);
}

async function editEdge(edgeId) {
  const state = await loadGraphStateFromBackground();
  const edge = (state.edges || []).find((candidate) => candidate.edgeId === edgeId);

  if (!edge) {
    return;
  }

  openEditor(edge);
}

async function deleteEdge(edgeId) {
  const confirmDelete = window.confirm("Delete this relationship?");

  if (!confirmDelete) {
    return;
  }

  await browser.runtime.sendMessage({
    type: "graph:delete-edge",
    edgeId
  });

  await renderPopup();
}

function openEditor(edge) {
  currentEditEdgeId = edge.edgeId;
  const editor = document.getElementById("edge-editor");
  editor.dataset.open = "true";
  document.getElementById("editor-edge-id").value = edge.edgeId || "";
  const sourceUrl = edge.sourceKey || edge.metadata?.sourceCanonicalUrl || "";
  const targetUrl = edge.targetKey || edge.metadata?.targetCanonicalUrl || "";
  document.getElementById("editor-source-url").value = sourceUrl;
  document.getElementById("editor-target-url").value = targetUrl;
  document.getElementById("editor-relation-type").value = edge.relationType || "related_to";
  document.getElementById("editor-note").value = edge.note || "";
  document.getElementById("editor-origin").value = edge.metadata?.relationTypeOrigin || "custom";
}

function closeEditor() {
  currentEditEdgeId = null;
  document.getElementById("edge-editor").dataset.open = "false";
  document.getElementById("editor-edge-id").value = "";
  document.getElementById("editor-source-url").value = "";
  document.getElementById("editor-target-url").value = "";
  document.getElementById("editor-relation-type").value = "";
  document.getElementById("editor-note").value = "";
  document.getElementById("editor-origin").value = "custom";
}

async function saveEditorChanges() {
  if (!currentEditEdgeId) {
    return;
  }

  await browser.runtime.sendMessage({
    type: "graph:update-edge",
    edgeId: currentEditEdgeId,
    updates: {
      relationType: document.getElementById("editor-relation-type").value,
      note: document.getElementById("editor-note").value,
      metadata: {
        relationTypeOrigin: document.getElementById("editor-origin").value
      }
    }
  });

  closeEditor();
  await renderPopup();
}

document.getElementById("edge-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action][data-edge-id]");

  if (!button) {
    return;
  }

  const edgeId = button.dataset.edgeId;

  if (button.dataset.action === "edit-edge") {
    await editEdge(edgeId);
    return;
  }

  if (button.dataset.action === "delete-edge") {
    await deleteEdge(edgeId);
  }
});

document.getElementById("copy-cypher").addEventListener("click", copyCypher);
document.getElementById("refresh-view").addEventListener("click", renderPopup);
document.getElementById("save-edge").addEventListener("click", saveEditorChanges);
document.getElementById("cancel-edit").addEventListener("click", closeEditor);

document.getElementById("extension-enabled-toggle").addEventListener("change", async (event) => {
  await setExtensionEnabled(event.target.checked);
  await renderPopup();
});

renderPopup();