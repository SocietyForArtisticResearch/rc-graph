# rcGraph

Firefox extension for annotating relationships between tools in a research catalogue and exporting the result to Neo4j.

## What this does

rcGraph runs on catalogue pages that contain tool cards or tool elements. It lets you select two tools, define a relationship between them, and store that annotation as a graph edge.

The extension keeps a local graph state in Firefox storage and can export the result as Cypher for Neo4j.

## What is implemented

- Firefox extension scaffold with a no-build JavaScript setup.
- Content script that detects tools on catalogue pages and lets you create relationships between them.
- Cross-page selection, so you can pick a source tool on one page and a target tool on another page.
- Canonical tool identity based on normalized page URL plus `data-id`.
- Expandable relationship presets that grow when you type a new relationship type.
- Popup UI for reviewing edges, grouped by relationship type.
- Inline editing and delete support for saved edges.
- Canonical URLs in the popup, with clickable links in the relationship list and read-only URLs in the editor.
- Cypher export for Neo4j.
- Shift-click pass-through mode, which lets the page receive a click when you want the underlying media or page element to respond.

## How it works

Relationships can span multiple catalogue pages. That means a tool is not identified by its page-local `data-id` alone.

The node identity is:

- normalized page URL
- tool ID from `data-id`

The canonical node key is the tool page URL with a `#tool-<id>` fragment. That lets the extension store a selection from one page, navigate to another page, select a second tool, and then create a relationship between the two.

That also means the graph state needs to keep a pending selection until the user completes the second half of the edge.

## Usage

1. Open a catalogue page that contains tool elements.
2. Click one tool to choose the source.
3. Click another tool to choose the target.
4. Pick a relationship type from the presets or type your own.
5. Open the popup to review saved relationships and copy the Cypher export.

Normal clicks are handled by the extension and do not reach the page itself. Hold Shift while clicking if you want the page to receive the click as well; in that mode the overlay outlines are hidden.

## Project setup

This repository is intentionally a no-build Firefox extension. The browser loads the JavaScript files in `src/` directly, so there is no TypeScript compilation step or bundler involved.

That keeps the first version simple while we validate the annotation workflow and graph export shape.

## Data model direction

Each tool node should have:

- a normalized page URL
- a tool ID from the page's `data-id`
- a canonical node key composed from page URL plus tool ID
- a label
- a tool type
- optional metadata such as position, author, or description

Each edge should include:

- source node key
- target node key
- relationship type
- note or justification
- timestamps
- optional provenance fields

## Export strategy

We will keep the internal working model structured, then generate Cypher for Neo4j export.

That gives us:

- a simple editor-friendly internal format
- a clean path to Neo4j
- room for future import/export formats if needed

## Summary of completed work

- The extension was scaffolded as a Firefox-compatible MV2 add-on.
- The codebase was converted to plain JavaScript with no build step.
- Canonical tool URLs and stable edge IDs were added.
- The popup now groups relationships by type and supports edit/delete.
- Relationship presets now persist and expand as you type new values.
- The export path now generates Cypher suitable for Neo4j.
- A local Neo4j launcher script was added for easy startup.
- Tool clicks are intercepted by the extension unless Shift is held.

## Open design choices

- whether the canonical text format should be Cypher-first or a neutral graph syntax with Cypher export
- which metadata should be stored in Neo4j versus kept only in the extension
- how much selection state should persist between pages before the edge is completed