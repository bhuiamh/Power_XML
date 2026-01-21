import { Element, xml2js } from 'xml-js';

type ChangeKind = 'added' | 'removed' | 'changed';

export type Diff = {
  path: string;
  leftValue?: string;
  rightValue?: string;
  change: ChangeKind;
};

type WorkerRequest = {
  leftXml: string;
  rightXml: string;
};

type WorkerProgress = {
  ok: true;
  type: 'progress';
  phase: 'left' | 'right' | 'diff';
  percent: number;
  message?: string;
};

type WorkerDone =
  | {
      ok: true;
      type: 'done';
      differences: Diff[];
      stats: Record<ChangeKind, number>;
    }
  | {
      ok: false;
      type: 'error';
      leftError?: string;
      rightError?: string;
    };

type WorkerResponse = WorkerProgress | WorkerDone;

function extractText(nodes: Element[] | undefined): string {
  if (!nodes) return '';
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'cdata') {
      out += (node as { text?: string }).text ?? '';
    }
  }
  return out.trim();
}

function mapXmlToFlat(
  xml: string,
  opts: { phase: 'left' | 'right'; basePercent: number; spanPercent: number; postProgress: (p: number, msg?: string) => void }
): { map: Record<string, string>; error?: string } {
  try {
    opts.postProgress(opts.basePercent, 'Parsing XML…');
    const parsed = xml2js(xml, { compact: false, ignoreDeclaration: true });
    const rootElements = (parsed as { elements?: Element[] }).elements;
    const collector: Record<string, string> = {};

    // Iterative DFS to avoid deep recursion hazards on large docs
    const stack: Array<{ elements: Element[] | undefined; path: string[] }> = [
      { elements: rootElements, path: [] }
    ];

    let processedElements = 0;
    let lastEmit = 0;

    while (stack.length) {
      const item = stack.pop()!;
      const elements = item.elements;
      if (!elements) continue;

      const siblingCounts: Record<string, number> = {};
      for (const el of elements) {
        if (el.type !== 'element') continue;

        processedElements += 1;

        const name = el.name ?? 'unnamed';
        const currentIndex = (siblingCounts[name] ?? 0) + 1;
        siblingCounts[name] = currentIndex;

        const currentPath = [...item.path, `${name}[${currentIndex}]`];
        const pathString = currentPath.join('.');

        if (el.attributes) {
          for (const [attrName, attrValue] of Object.entries(el.attributes)) {
            collector[`${pathString}/@${attrName}`] = String(attrValue);
          }
        }

        const textContent = extractText(el.elements);
        if (textContent) {
          collector[`${pathString}/#text`] = textContent;
        }

        // Push children for later processing (only if there are any element nodes)
        const children = el.elements?.filter((n) => n.type === 'element') as Element[] | undefined;
        if (children && children.length > 0) {
          stack.push({ elements: children, path: currentPath });
        }

        // Progress estimate without needing a full pre-count:
        // ratio ~= processed / (processed + remaining_work)
        // remaining_work is approximated by stack size (number of pending batches).
        if (processedElements - lastEmit >= 250) {
          lastEmit = processedElements;
          const ratio = processedElements / (processedElements + stack.length + 1);
          const pct = Math.min(
            99,
            Math.max(0, Math.round(opts.basePercent + ratio * opts.spanPercent))
          );
          opts.postProgress(pct, 'Scanning elements…');
        }
      }
    }

    opts.postProgress(opts.basePercent + opts.spanPercent, 'Flatten complete');
    return { map: collector };
  } catch (error) {
    return { map: {}, error: (error as Error).message };
  }
}

function diffMaps(left: Record<string, string>, right: Record<string, string>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const differences: Diff[] = [];
  const stats: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0 };

  keys.forEach((key) => {
    if (!(key in right)) {
      differences.push({ path: key, leftValue: left[key], change: 'removed' });
      stats.removed += 1;
    } else if (!(key in left)) {
      differences.push({ path: key, rightValue: right[key], change: 'added' });
      stats.added += 1;
    } else if (left[key] !== right[key]) {
      differences.push({
        path: key,
        leftValue: left[key],
        rightValue: right[key],
        change: 'changed'
      });
      stats.changed += 1;
    }
  });

  differences.sort((a, b) => a.path.localeCompare(b.path));
  return { differences, stats };
}

// eslint-disable-next-line no-restricted-globals
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { leftXml, rightXml } = event.data;

  const postProgress = (phase: 'left' | 'right' | 'diff', percent: number, message?: string) => {
    const resp: WorkerResponse = { ok: true, type: 'progress', phase, percent, message };
    // eslint-disable-next-line no-restricted-globals
    self.postMessage(resp);
  };

  // Left: 0..45, Right: 45..90, Diff: 90..100
  const left = mapXmlToFlat(leftXml, {
    phase: 'left',
    basePercent: 0,
    spanPercent: 45,
    postProgress: (p, msg) => postProgress('left', p, msg)
  });

  const right = mapXmlToFlat(rightXml, {
    phase: 'right',
    basePercent: 45,
    spanPercent: 45,
    postProgress: (p, msg) => postProgress('right', p, msg)
  });

  if (left.error || right.error) {
    const resp: WorkerResponse = {
      ok: false,
      type: 'error',
      leftError: left.error,
      rightError: right.error
    };
    // eslint-disable-next-line no-restricted-globals
    self.postMessage(resp);
    return;
  }

  postProgress('diff', 92, 'Diffing…');
  const { differences, stats } = diffMaps(left.map, right.map);
  postProgress('diff', 99, 'Finalizing…');
  const resp: WorkerResponse = { ok: true, type: 'done', differences, stats };
  // eslint-disable-next-line no-restricted-globals
  self.postMessage(resp);
};


