/**
 * fromEds.js - Convert EDS output back to custom element markup
 *
 * Supports two formats:
 * 1. Author format (divs) - returned from DA when retrieving stored content
 * 2. Published format (div blocks) - output from EDS pipeline
 *
 * Both formats use div.experience-element blocks with rows/cells:
 * <div class="experience-element">
 *   <div><div>element-name</div><div>paywall-card</div></div>
 *   <div><div>plan-name</div><div>Firefly Standard</div></div>
 * </div>
 *
 * Also supports table format for local testing:
 * <table>
 *   <tr><td colspan="2">experience-element</td></tr>
 *   <tr><td>element-name</td><td>paywall-card</td></tr>
 * </table>
 *
 * Converts to:
 * <paywall-card>
 *   <span slot="plan-name">Firefly Standard</span>
 * </paywall-card>
 */

import { VANILLA_TAGS } from './vanilla-tags.js';

class EDSBlockDeserializer {
  #blockMap = new Map();

  #tableMap = new Map();

  /**
   * Check if a class name represents a custom element block
   */
  isCustomElementClass(className) {
    // "experience-element" is the generic block name for all custom elements
    if (className === 'experience-element') {
      return true;
    }
    return className && className.includes('-') && !VANILLA_TAGS.has(className);
  }

  /**
   * Extract element-name from a block div
   */
  getElementName(blockDiv) {
    const rows = Array.from(blockDiv.children).filter((c) => c.tagName === 'DIV');
    for (const row of rows) {
      const cells = Array.from(row.children).filter((c) => c.tagName === 'DIV');
      if (cells.length === 2 && cells[0].textContent.trim() === 'element-name') {
        return cells[1].textContent.trim();
      }
    }
    // Fallback to class name if no element-name row
    const classes = (blockDiv.className || '').split(/\s+/).filter(Boolean);
    const blockClass = classes.find((c) => c.includes('-') && !VANILLA_TAGS.has(c) && c !== 'experience-element');
    return blockClass || null;
  }

  /**
   * Convert CSS class name back to tag name
   * e.g., "paywall-card" -> "paywall-card"
   */
  classToTagName(className) {
    return className.toLowerCase();
  }

  /**
   * Build a map of block IDs to block elements
   */
  buildBlockMap(blocks) {
    this.#blockMap.clear();
    const blockCounts = new Map();

    for (const block of blocks) {
      // Get the actual element name (from element-name row or class)
      const elementName = this.getElementName(block);
      if (elementName) {
        const nameLower = elementName.toLowerCase();
        const count = (blockCounts.get(nameLower) || 0) + 1;
        blockCounts.set(nameLower, count);
        const blockId = `${nameLower}-${count}`;
        this.#blockMap.set(blockId, block);
      }
    }
  }

  /**
   * Parse a block row to extract slot name and content
   * Row format: <div><div>slot-name</div><div>content</div></div>
   */
  parseBlockRow(rowDiv) {
    const cells = Array.from(rowDiv.children).filter((c) => c.tagName === 'DIV');

    if (cells.length === 0) {
      return null;
    }

    if (cells.length === 1) {
      // Single cell - could be content or nested block
      return {
        slotName: null,
        content: cells[0],
      };
    }

    // Two cells: first is slot name, second is content
    // Check if slot name is wrapped in <strong> (indicates slot, not attribute)
    const strongEl = cells[0].querySelector('strong');
    const isSlot = !!strongEl;
    const slotName = strongEl ? strongEl.textContent.trim() : cells[0].textContent.trim();
    const content = cells[1];

    return {
      slotName,
      content,
      isSlot,
    };
  }

  /**
   * Check if content div contains a nested block
   */
  findNestedBlock(contentDiv) {
    for (const child of contentDiv.children) {
      if (child.tagName === 'DIV' && child.className) {
        const classes = child.className.split(/\s+/);
        const blockClass = classes.find((c) => this.isCustomElementClass(c));
        if (blockClass) {
          return { element: child, blockClass };
        }
      }
    }
    return null;
  }

  /**
   * Parse references from content text (e.g., "→ inline-price-1, → inline-price-2")
   */
  parseReferences(text) {
    const refs = [];
    // Match references like "→ div-1", "→ ee-media-1", "→ paywall-card-2"
    const matches = text.matchAll(/→\s*([a-z][a-z0-9-]*-\d+)/gi);
    for (const match of matches) {
      refs.push(match[1].toLowerCase());
    }
    return refs;
  }

  /**
   * Check if content div is just a simple <p> wrapper around plain text
   * DA author format wraps all text in <p> tags, but this shouldn't create slots
   */
  #isSimplePWrapper(contentDiv) {
    const children = Array.from(contentDiv.children);
    if (children.length !== 1) return false;
    const child = children[0];
    if (child.tagName !== 'P') return false;
    // Check if <p> contains only text (no nested elements)
    return child.children.length === 0;
  }

  /**
   * Check if content is purely references (no other content)
   */
  isReferenceOnly(text) {
    // Remove all references and whitespace, check if anything remains
    const withoutRefs = text.replace(/→\s*[a-z][a-z0-9-]*-\d+/gi, '').replace(/,/g, '').trim();
    return withoutRefs === '';
  }

  /**
   * Convert content div to appropriate slotted content
   */
  convertContent(contentDiv, slotName) {
    // Check for nested blocks first
    const nestedBlock = this.findNestedBlock(contentDiv);
    if (nestedBlock) {
      const converted = this.convertBlock(nestedBlock.element);
      if (slotName) {
        converted.setAttribute('slot', slotName);
      }
      return converted;
    }

    // Get inner HTML content
    const innerHTML = contentDiv.innerHTML.trim();
    const textContent = contentDiv.textContent.trim();

    // Check for references (→ block-id)
    const refs = this.parseReferences(textContent);
    if (refs.length > 0 && this.isReferenceOnly(textContent)) {
      // Content is purely references - resolve them
      const fragment = document.createDocumentFragment();
      for (const refId of refs) {
        const refBlock = this.#blockMap.get(refId);
        if (refBlock) {
          const converted = this.convertBlock(refBlock);
          if (slotName) {
            converted.setAttribute('slot', slotName);
          }
          fragment.appendChild(converted);
        }
      }
      return fragment;
    }

    // If content has block-level elements, preserve them
    const hasBlockElements = /<(p|h[1-6]|div|ul|ol|table)/i.test(innerHTML);

    if (hasBlockElements) {
      // Clone children and add slot attribute
      const fragment = document.createDocumentFragment();
      Array.from(contentDiv.childNodes).forEach((node) => {
        const cloned = node.cloneNode(true);
        if (cloned.nodeType === Node.ELEMENT_NODE && slotName) {
          cloned.setAttribute('slot', slotName);
        }
        fragment.appendChild(cloned);
      });
      return fragment;
    }

    // Simple content - wrap in appropriate element
    const wrapper = document.createElement('span');
    wrapper.innerHTML = innerHTML;
    if (slotName) {
      wrapper.setAttribute('slot', slotName);
    }
    return wrapper;
  }

  /**
   * Convert an EDS block div to a custom element
   */
  convertBlock(blockDiv) {
    const classes = (blockDiv.className || '').split(/\s+/).filter(Boolean);
    const blockClass = classes.find((c) => this.isCustomElementClass(c));

    if (!blockClass) {
      // Not a block, return as-is
      return blockDiv.cloneNode(true);
    }

    // Get the actual element name (from element-name row or class)
    const elementName = this.getElementName(blockDiv);
    if (!elementName) {
      return blockDiv.cloneNode(true);
    }

    // Create custom element using DOMParser to avoid custom element upgrade errors
    const tagName = elementName.toLowerCase();
    const parser = new DOMParser();
    const tempDoc = parser.parseFromString(`<${tagName}></${tagName}>`, 'text/html');
    const element = tempDoc.body.firstElementChild;

    if (!element) {
      // Fallback: create element directly if DOMParser fails
      const fallbackElement = document.createElement(tagName);
      return fallbackElement;
    }

    // Copy additional classes as attributes or variants (excluding experience-element and element name)
    const otherClasses = classes.filter((c) => c !== blockClass && c !== 'experience-element' && c !== elementName);
    if (otherClasses.length > 0) {
      // Could be variants - add as attributes
      otherClasses.forEach((cls) => {
        element.setAttribute(cls, '');
      });
    }

    // Process rows
    const rows = Array.from(blockDiv.children).filter((c) => c.tagName === 'DIV');
    const styleVars = {};

    for (const row of rows) {
      const parsed = this.parseBlockRow(row);
      if (!parsed) continue;

      const { slotName, content, isSlot } = parsed;

      // Skip element-name row (already handled)
      if (slotName === 'element-name') {
        continue;
      }

      const textContent = content.textContent.trim();
      const innerHTML = content.innerHTML.trim();

      // 1. Style variables: "style-*" prefix → CSS custom property
      if (slotName?.startsWith('style-')) {
        const varName = slotName.substring(6);
        styleVars[`--${varName}`] = textContent;
        continue;
      }

      // 2. References: "→ block-id" → resolve and append as children
      const refs = this.parseReferences(textContent);
      if (refs.length > 0 && this.isReferenceOnly(textContent)) {
        for (const refId of refs) {
          const refBlock = this.#blockMap.get(refId);
          if (refBlock) {
            const converted = this.convertBlock(refBlock);
            // Only set slot if slotName is provided and not "children" (unslotted)
            if (slotName && slotName !== 'children') {
              converted.setAttribute('slot', slotName);
            }
            element.appendChild(converted);
          }
        }
        // Always continue after processing references, even if some couldn't be resolved
        continue;
      }

      // 3. Content already has slot attribute → append children directly
      const slottedChild = content.querySelector('[slot]');
      if (slottedChild) {
        Array.from(content.childNodes).forEach((node) => {
          element.appendChild(node.cloneNode(true));
        });
        continue;
      }

      // 4. Unslotted HTML content (single cell row with no slotName) → append without slot
      if (slotName === null) {
        // If content is a single <p>, unwrap it (DA wraps text in <p>)
        const children = Array.from(content.children);
        if (children.length === 1 && children[0].tagName === 'P') {
          Array.from(children[0].childNodes).forEach((node) => {
            element.appendChild(node.cloneNode(true));
          });
        } else {
          Array.from(content.childNodes).forEach((node) => {
            element.appendChild(node.cloneNode(true));
          });
        }
        continue;
      }

      // 5. Bold-marked slot name (isSlot=true) → always create slot content
      if (isSlot) {
        const wrapper = document.createElement('span');
        wrapper.innerHTML = innerHTML;
        wrapper.setAttribute('slot', slotName);
        element.appendChild(wrapper);
        continue;
      }

      // 6. Check if content is just a simple <p> wrapper (DA author format wraps text in <p>)
      // If so, treat as plain text for attribute, not as HTML content
      const isSimplePWrapper = this.#isSimplePWrapper(content);

      // 7. HTML content (has tags, but not just a simple <p> wrapper) → slot content
      if (innerHTML !== textContent && !isSimplePWrapper) {
        const converted = this.convertContent(content, slotName);
        if (converted instanceof DocumentFragment) {
          element.appendChild(converted);
        } else if (converted) {
          element.appendChild(converted);
        }
        continue;
      }

      // 8. Plain text → attribute
      if (slotName) {
        // Convert 'attr-type' back to 'type' (was prefixed to avoid collision with block type)
        const attrName = slotName === 'attr-type' ? 'type' : slotName;
        element.setAttribute(attrName, textContent);
      }
    }

    // Apply collected style variables as style attribute
    if (Object.keys(styleVars).length > 0) {
      const styleStr = Object.entries(styleVars)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
      element.setAttribute('style', styleStr);
    }

    return element;
  }

  /**
   * Find all block divs in the document
   */
  findBlocks(root) {
    const blocks = [];
    const walk = (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      if (node.tagName === 'DIV' && node.className) {
        const classes = node.className.split(/\s+/);
        if (classes.some((c) => this.isCustomElementClass(c))) {
          blocks.push(node);
          return; // Don't recurse into blocks
        }
      }

      for (const child of node.children) {
        walk(child);
      }
    };

    walk(root);
    return blocks;
  }

  /**
   * Find the root block (the one not referenced by any other block)
   */
  findRootBlock(blocks) {
    if (blocks.length === 0) return null;
    if (blocks.length === 1) return blocks[0];

    // Collect all referenced block IDs (e.g., "ee-media-1", "paywall-card-2")
    const referencedIds = new Set();
    for (const block of blocks) {
      const text = block.textContent;
      // Match references like "→ div-1", "→ ee-media-1", "→ paywall-card-2"
      const matches = text.matchAll(/→\s*([a-z][a-z0-9-]*-\d+)/gi);
      for (const match of matches) {
        referencedIds.add(match[1].toLowerCase());
      }
    }

    // For each block, determine its ID by looking at element-name and position
    // Blocks are numbered in order of appearance
    const blockCounts = new Map();
    const blockIds = new Map();

    for (const block of blocks) {
      const elementName = this.getElementName(block);
      if (elementName) {
        const nameLower = elementName.toLowerCase();
        const count = (blockCounts.get(nameLower) || 0) + 1;
        blockCounts.set(nameLower, count);
        const blockId = `${nameLower}-${count}`;
        blockIds.set(block, blockId);
      }
    }

    // Find blocks that are not referenced
    const unreferencedBlocks = [];
    for (const block of blocks) {
      const blockId = blockIds.get(block);
      if (blockId && !referencedIds.has(blockId)) {
        unreferencedBlocks.push(block);
      }
    }

    // If only one unreferenced block, return it
    if (unreferencedBlocks.length === 1) {
      return unreferencedBlocks[0];
    }

    // If multiple unreferenced blocks, return the last one (root is typically last in EDS output)
    if (unreferencedBlocks.length > 1) {
      return unreferencedBlocks[unreferencedBlocks.length - 1];
    }

    // Fallback to last block
    return blocks[blocks.length - 1];
  }

  /**
   * Find all experience-element tables in the document (author format)
   */
  findTables(root) {
    const tables = [];
    for (const table of root.querySelectorAll('table')) {
      const firstCell = table.querySelector('tr td');
      if (firstCell?.textContent.trim() === 'experience-element') {
        tables.push(table);
      }
    }
    return tables;
  }

  /**
   * Build a map of table IDs from author format tables
   */
  buildTableMap(tables) {
    this.#tableMap.clear();
    const tableCounts = new Map();

    for (const table of tables) {
      const elementName = this.getElementNameFromTable(table);
      if (elementName) {
        const nameLower = elementName.toLowerCase();
        const count = (tableCounts.get(nameLower) || 0) + 1;
        tableCounts.set(nameLower, count);
        const tableId = `${nameLower}-${count}`;
        this.#tableMap.set(tableId, table);
      }
    }
  }

  /**
   * Extract element-name from a table
   */
  getElementNameFromTable(table) {
    const rows = table.querySelectorAll('tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length === 2 && cells[0].textContent.trim() === 'element-name') {
        return cells[1].textContent.trim();
      }
    }
    return null;
  }

  /**
   * Convert an author format table to a custom element
   */
  convertTable(table) {
    const elementName = this.getElementNameFromTable(table);
    if (!elementName) {
      return null;
    }

    // Create custom element using DOMParser to avoid custom element upgrade errors
    const tagName = elementName.toLowerCase();
    const parser = new DOMParser();
    const tempDoc = parser.parseFromString(`<${tagName}></${tagName}>`, 'text/html');
    const element = tempDoc.body.firstElementChild;

    if (!element) {
      return document.createElement(tagName);
    }

    const rows = table.querySelectorAll('tr');
    const styleVars = {};

    for (const row of rows) {
      const cells = row.querySelectorAll('td');

      // Skip header row (experience-element)
      if (cells.length === 1 && cells[0].getAttribute('colspan') === '2') {
        const text = cells[0].textContent.trim();
        if (text === 'experience-element') {
          continue;
        }
        // Unslotted HTML content (colspan=2 but not header)
        // If content is a single <p>, unwrap it (toEds wraps content to protect <strong> tags)
        const children = Array.from(cells[0].children);
        if (children.length === 1 && children[0].tagName === 'P') {
          // Single <p> wrapper - unwrap by appending its children
          Array.from(children[0].childNodes).forEach((node) => {
            element.appendChild(node.cloneNode(true));
          });
        } else {
          // Multiple children or not a <p> - append as-is
          Array.from(cells[0].childNodes).forEach((node) => {
            element.appendChild(node.cloneNode(true));
          });
        }
        continue;
      }

      if (cells.length !== 2) continue;

      const key = cells[0].textContent.trim();
      const valueCell = cells[1];
      const textContent = valueCell.textContent.trim();
      const innerHTML = valueCell.innerHTML.trim();

      // Skip element-name row (already handled)
      if (key === 'element-name') {
        continue;
      }

      // 1. Style variables: "style-*" prefix → CSS custom property
      if (key.startsWith('style-')) {
        const varName = key.substring(6);
        styleVars[`--${varName}`] = textContent;
        continue;
      }

      // 2. References: "→ table-id" → resolve and append as children
      const refs = this.parseReferences(textContent);
      if (refs.length > 0 && this.isReferenceOnly(textContent)) {
        for (const refId of refs) {
          const refTable = this.#tableMap.get(refId);
          if (refTable) {
            const converted = this.convertTable(refTable);
            if (converted) {
              // Only set slot if key is provided and not "children" (unslotted)
              if (key && key !== 'children') {
                converted.setAttribute('slot', key);
              }
              element.appendChild(converted);
            }
          }
        }
        continue;
      }

      // 3. HTML content (has tags) → slot content
      if (innerHTML !== textContent) {
        // Check if content already has slot attribute - append directly without wrapping
        const slottedChild = valueCell.querySelector('[slot]');
        if (slottedChild) {
          Array.from(valueCell.childNodes).forEach((node) => {
            element.appendChild(node.cloneNode(true));
          });
          continue;
        }
        // Wrap in span with slot attribute
        const wrapper = document.createElement('span');
        wrapper.innerHTML = innerHTML;
        if (key) {
          wrapper.setAttribute('slot', key);
        }
        element.appendChild(wrapper);
        continue;
      }

      // 4. Plain text → attribute
      if (key) {
        // Convert 'attr-type' back to 'type' (was prefixed to avoid collision with block type)
        const attrName = key === 'attr-type' ? 'type' : key;
        element.setAttribute(attrName, textContent);
      }
    }

    // Apply collected style variables as style attribute
    if (Object.keys(styleVars).length > 0) {
      const styleStr = Object.entries(styleVars)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
      element.setAttribute('style', styleStr);
    }

    return element;
  }

  /**
   * Find the root table (the one not referenced by any other table)
   */
  findRootTable(tables) {
    if (tables.length === 0) return null;
    if (tables.length === 1) return tables[0];

    // Collect all referenced table IDs
    const referencedIds = new Set();
    for (const table of tables) {
      const text = table.textContent;
      const matches = text.matchAll(/→\s*([a-z][a-z0-9-]*-\d+)/gi);
      for (const match of matches) {
        referencedIds.add(match[1].toLowerCase());
      }
    }

    // Build table ID map
    const tableCounts = new Map();
    const tableIds = new Map();

    for (const table of tables) {
      const elementName = this.getElementNameFromTable(table);
      if (elementName) {
        const nameLower = elementName.toLowerCase();
        const count = (tableCounts.get(nameLower) || 0) + 1;
        tableCounts.set(nameLower, count);
        const tableId = `${nameLower}-${count}`;
        tableIds.set(table, tableId);
      }
    }

    // Find tables that are not referenced
    const unreferencedTables = [];
    for (const table of tables) {
      const tableId = tableIds.get(table);
      if (tableId && !referencedIds.has(tableId)) {
        unreferencedTables.push(table);
      }
    }

    if (unreferencedTables.length === 1) {
      return unreferencedTables[0];
    }

    if (unreferencedTables.length > 1) {
      return unreferencedTables[unreferencedTables.length - 1];
    }

    return tables[tables.length - 1];
  }

  /**
   * Convert EDS HTML to custom element markup
   * Supports both author format (tables) and published format (div blocks)
   * Expects input wrapped in <body><header></header><main>content</main></body>
   */
  fromEDS(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Look for content inside <main>, fall back to <body>
    const main = doc.body.querySelector('main');
    const root = main || doc.body;

    // Try author format (tables) first
    const tables = this.findTables(root);
    if (tables.length > 0) {
      this.buildTableMap(tables);
      const rootTable = this.findRootTable(tables);
      const converted = this.convertTable(rootTable);
      return converted ? converted.outerHTML : html;
    }

    // Fall back to published format (div blocks)
    const blocks = this.findBlocks(root);

    if (blocks.length === 0) {
      return html;
    }

    // Build map of block IDs for reference resolution
    this.buildBlockMap(blocks);

    // Find the root block (not referenced by any other block)
    const rootBlock = this.findRootBlock(blocks);
    const converted = this.convertBlock(rootBlock);

    return converted.outerHTML;
  }

  /**
   * Convert EDS HTML to DOM element
   * Supports both author format (tables) and published format (div blocks)
   * Expects input wrapped in <body><header></header><main>content</main></body>
   */
  toElement(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Look for content inside <main>, fall back to <body>
    const main = doc.body.querySelector('main');
    const root = main || doc.body;

    // Try author format (tables) first
    const tables = this.findTables(root);
    if (tables.length > 0) {
      this.buildTableMap(tables);
      return this.convertTable(tables[0]);
    }

    // Fall back to published format (div blocks)
    const blocks = this.findBlocks(root);

    if (blocks.length === 0) {
      return root.firstElementChild;
    }

    // Build map of block IDs for reference resolution
    this.buildBlockMap(blocks);

    return this.convertBlock(blocks[0]);
  }
}

/**
 * Convert EDS output to custom element markup
 * Supports both author format (tables) and published format (div blocks)
 */
function fromEds(input, options = {}) {
  const deserializer = new EDSBlockDeserializer();

  if (options.asElement) {
    return deserializer.toElement(input);
  }

  return deserializer.fromEDS(input);
}

export { fromEds, EDSBlockDeserializer };
