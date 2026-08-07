function getToolCandidates() {
  return Array.from(document.querySelectorAll(".tool[data-id][data-tool]"));
}

async function loadGraphStateFromBackground() {
  return browser.runtime.sendMessage({ type: "graph:get" });
}

let extensionEnabled = true;
let shiftKeyPressed = false;

function installStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .rcgraph-tool-ready {
      outline: none;
      cursor: default;
    }

    html.rcgraph-overlay-active .rcgraph-tool-ready {
      outline: 1px solid rgba(0, 120, 255, 0.35);
      cursor: pointer;
    }

    html.rcgraph-overlay-active .rcgraph-tool-ready:hover {
      outline-color: rgba(0, 120, 255, 0.9);
    }

    .rcgraph-tool-selected {
      outline: none !important;
      box-shadow: none !important;
    }

    #rcgraph-status {
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 2147483647;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(17, 24, 39, 0.92);
      color: #fff;
      font: 12px/1.3 system-ui, sans-serif;
      max-width: 280px;
    }

    #rcgraph-relation-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.42);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    #rcgraph-relation-dialog {
      width: min(92vw, 420px);
      border: 1px solid rgba(148, 163, 184, 0.3);
      border-radius: 14px;
      background: #fff;
      color: #0f172a;
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.22);
      padding: 16px;
      font: 14px/1.4 system-ui, sans-serif;
    }

    #rcgraph-relation-dialog h2 {
      margin: 0 0 8px;
      font-size: 16px;
    }

    #rcgraph-relation-dialog p {
      margin: 0 0 12px;
      color: #475569;
    }

    #rcgraph-relation-dialog label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
      color: #334155;
    }

    #rcgraph-relation-input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 10px 12px;
      font: inherit;
      margin-bottom: 12px;
    }

    .rcgraph-relation-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }

    .rcgraph-relation-preset,
    .rcgraph-relation-action {
      border: 0;
      border-radius: 999px;
      padding: 8px 12px;
      font: inherit;
      cursor: pointer;
    }

    .rcgraph-relation-preset {
      background: #e2e8f0;
      color: #0f172a;
    }

    .rcgraph-relation-preset:hover {
      background: #cbd5e1;
    }

    .rcgraph-relation-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .rcgraph-relation-action {
      background: #0b74ff;
      color: #fff;
    }

    .rcgraph-relation-action[data-variant="cancel"] {
      background: #e2e8f0;
      color: #0f172a;
    }
  `;
  document.documentElement.append(style);
}

function ensureStatus() {
  let status = document.getElementById("rcgraph-status");

  if (!status) {
    status = document.createElement("div");
    status.id = "rcgraph-status";
    document.documentElement.append(status);
  }

  return status;
}

function setStatus(message) {
  ensureStatus().textContent = message;
}

function setSelectedTool(element) {
  for (const tool of getToolCandidates()) {
    tool.classList.remove("rcgraph-tool-selected");
  }

  element.classList.add("rcgraph-tool-selected");
}

function setOverlayMode(enabled) {
  document.documentElement.classList.toggle("rcgraph-overlay-active", enabled);
}

function syncOverlayState() {
  setOverlayMode(extensionEnabled && shiftKeyPressed);
}

function applyExtensionState(state) {
  extensionEnabled = state.extensionEnabled !== false;

  if (!extensionEnabled) {
    removeRelationDialog();
  }

  syncOverlayState();

  if (extensionEnabled) {
    setStatus(`rcGraph ready: ${getToolCandidates().length} tools detected.`);
  } else {
    setStatus("rcGraph disabled.");
  }
}

function removeRelationDialog() {
  document.getElementById("rcgraph-relation-backdrop")?.remove();
}

function openRelationDialog(relationPresets) {
  return new Promise((resolve) => {
    removeRelationDialog();

    const backdrop = document.createElement("div");
    backdrop.id = "rcgraph-relation-backdrop";

    const dialog = document.createElement("div");
    dialog.id = "rcgraph-relation-dialog";

    dialog.innerHTML = `
      <h2>Choose a relationship</h2>
      <p>Select a common relation below, or type your own.</p>
      <label for="rcgraph-relation-input">Relationship type</label>
      <input id="rcgraph-relation-input" type="text" value="related_to" autocomplete="off" spellcheck="false" />
      <div class="rcgraph-relation-presets" role="group" aria-label="Relationship presets">
        ${relationPresets.map((relationType) => `<button class="rcgraph-relation-preset" type="button" data-value="${relationType}">${relationType}</button>`).join("")}
      </div>
      <div class="rcgraph-relation-actions">
        <button class="rcgraph-relation-action" type="button" data-variant="cancel">Cancel</button>
        <button class="rcgraph-relation-action" type="button" data-variant="save">Save</button>
      </div>
    `;

    backdrop.append(dialog);
    document.documentElement.append(backdrop);

    const input = dialog.querySelector("#rcgraph-relation-input");
    const saveButton = dialog.querySelector('[data-variant="save"]');
    const cancelButton = dialog.querySelector('[data-variant="cancel"]');
    const presetButtons = dialog.querySelectorAll(".rcgraph-relation-preset");

    function finish(value) {
      removeRelationDialog();
      resolve(value);
    }

    for (const button of presetButtons) {
      button.addEventListener("click", () => {
        input.value = button.dataset.value || "";
        input.focus();
        input.select();
      });
    }

    saveButton.addEventListener("click", () => {
      finish(input.value.trim() || null);
    });

    cancelButton.addEventListener("click", () => {
      finish(null);
    });

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        finish(null);
      }
    });

    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }

      if (event.key === "Enter" && event.target === input) {
        event.preventDefault();
        finish(input.value.trim() || null);
      }
    });

    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

async function completeEdge(targetNode) {
  const state = await loadGraphStateFromBackground();
  const relationPresets = state.relationPresets || DEFAULT_RELATION_PRESETS;
  const relationType = await openRelationDialog(relationPresets);

  if (relationType === null) {
    setStatus("Relationship creation canceled.");
    return;
  }

  const normalizedRelationType = String(relationType).trim();

  const response = await browser.runtime.sendMessage({
    type: "graph:complete-edge",
    relationType: normalizedRelationType,
    relationTypeOrigin: relationPresets.includes(normalizedRelationType) ? "preset" : "custom",
    targetNode
  });

  if (response?.status === "edge-stored") {
    setStatus(`Relationship stored as ${normalizedRelationType}.`);
    return;
  }

  setStatus("Could not store the relationship.");
}

async function handleToolClick(tool) {
  if (!extensionEnabled) {
    return;
  }

  const node = readToolNodeFromElement(tool);

  const response = await browser.runtime.sendMessage({
    type: "graph:select-tool",
    node
  });

  setSelectedTool(tool);

  if (response?.status === "pending-source") {
    setStatus(`Selected ${node.toolType} ${node.toolId}. Pick another tool to create a relationship.`);
    return;
  }

  if (response?.status === "awaiting-relation-type") {
    setStatus(`Selected target ${node.toolType} ${node.toolId}. Enter a relationship type.`);
    await completeEdge(node);
    return;
  }

  if (response?.status === "same-node") {
    setStatus(`Selected ${node.toolType} ${node.toolId}. Pick another tool to create a relationship.`);
    return;
  }

  setStatus(`Selected ${node.toolType} ${node.toolId}.`);
}

function handleToolClickCapture(event) {
  const tool = event.target.closest(".tool[data-id][data-tool]");

  if (!tool) {
    return;
  }

  if (!extensionEnabled || !event.shiftKey) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
  void handleToolClick(tool);
}

function handlePassThroughKeyMode(event) {
  if (event.key === "Shift") {
    shiftKeyPressed = event.type === "keydown";
    syncOverlayState();
  }
}

async function refreshExtensionState() {
  const state = await loadGraphStateFromBackground();
  applyExtensionState(state);
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.graphState) {
    return;
  }

  applyExtensionState(changes.graphState.newValue || {});
});

function annotateTools() {
  const tools = getToolCandidates();

  for (const tool of tools) {
    if (tool.dataset.rcGraphReady === "true") {
      continue;
    }

    tool.dataset.rcGraphReady = "true";
    tool.classList.add("rcgraph-tool-ready");
  }

  if (!window.__rcGraphClickCaptureInstalled) {
    window.__rcGraphClickCaptureInstalled = true;
    window.addEventListener("click", handleToolClickCapture, true);
    window.addEventListener("keydown", handlePassThroughKeyMode, true);
    window.addEventListener("keyup", handlePassThroughKeyMode, true);
  }

  syncOverlayState();
}

installStyles();
refreshExtensionState().then(() => {
  annotateTools();
});