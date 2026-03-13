export type ClickTextPosition = {
  node: Text;
  offset: number;
};

export function buildElementPath(element: Element, doc: Document): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current) {
    if (current === doc.documentElement) {
      parts.unshift("html");
      break;
    }

    if (current === doc.body) {
      parts.unshift("body");
      current = current.parentElement;
      continue;
    }

    const tagName = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) {
      break;
    }

    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName.toLowerCase() === tagName
    );
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${tagName}:nth-of-type(${index})`);
    current = parent;
  }

  return parts.join(" > ");
}

export function resolveClickTextPosition(event: MouseEvent, doc: Document): ClickTextPosition | null {
  const anyDoc = doc as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node | null; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  if (typeof anyDoc.caretPositionFromPoint === "function") {
    const position = anyDoc.caretPositionFromPoint(event.clientX, event.clientY);
    if (position?.offsetNode?.nodeType === Node.TEXT_NODE) {
      return {
        node: position.offsetNode as Text,
        offset: position.offset
      };
    }
  }

  if (typeof anyDoc.caretRangeFromPoint === "function") {
    const range = anyDoc.caretRangeFromPoint(event.clientX, event.clientY);
    if (range?.startContainer?.nodeType === Node.TEXT_NODE) {
      return {
        node: range.startContainer as Text,
        offset: range.startOffset
      };
    }
  }

  return null;
}

export function wordIndexWithinElement(root: Element, targetNode: Text, offset: number): number | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const wordPattern = /\S+/g;
  let seenWords = 0;
  let lastSeenInTarget: number | null = null;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const text = textNode.textContent ?? "";
    wordPattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = wordPattern.exec(text)) !== null) {
      const wordStart = match.index;
      const wordEnd = match.index + match[0].length;

      if (textNode === targetNode) {
        if (offset >= wordStart && offset <= wordEnd) {
          return seenWords;
        }

        if (offset > wordEnd) {
          lastSeenInTarget = seenWords;
        }
      }

      seenWords += 1;
    }

    if (textNode === targetNode) {
      return lastSeenInTarget;
    }
  }

  return null;
}
