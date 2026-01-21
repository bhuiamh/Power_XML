import { useState, useEffect, useRef, useCallback } from 'react';
import { xml2js, js2xml } from 'xml-js';

type XmlNode = {
  name: string;
  text?: string;
  attributes?: Record<string, string>;
  elements?: XmlNode[];
};

type EditableNode = {
  id: string;
  path: string;
  name: string;
  value: string;
  attributes: Record<string, string>;
  isText: boolean;
  children: EditableNode[];
};

type XmlEditorProps = {
  onNavigateToComparison?: () => void;
};

function buildEditableTree(elements: any[] | undefined, path: string = '', parentPath: string = ''): EditableNode[] {
  if (!elements) return [];

  const result: EditableNode[] = [];
  const siblingCounts: Record<string, number> = {};

  elements.forEach((el) => {
    if (el.type !== 'element') return;

    const name = el.name || 'unnamed';
    const count = (siblingCounts[name] || 0) + 1;
    siblingCounts[name] = count;
    const currentPath = path ? `${path}.${name}[${count}]` : `${name}[${count}]`;
    const id = currentPath;
    const fullParentPath = parentPath ? `${parentPath}.${name}` : name;

    // Text content
    const textNodes = el.elements?.filter((n: any) => n.type === 'text' || n.type === 'cdata') || [];
    const textValue = textNodes.map((n: any) => n.text || '').join('').trim();

    // Attributes
    const attributes = el.attributes || {};

    // Children (non-text elements)
    const childElements = el.elements?.filter((n: any) => n.type === 'element') || [];
    const children = buildEditableTree(childElements, currentPath, fullParentPath);

    result.push({
      id,
      path: currentPath,
      name,
      value: textValue,
      attributes,
      isText: true,
      children
    });
  });

  return result;
}

function buildXmlFromEditable(nodes: EditableNode[]): any[] {
  return nodes.map((node) => {
    const element: any = {
      type: 'element',
      name: node.name
    };

    if (Object.keys(node.attributes).length > 0) {
      element.attributes = node.attributes;
    }

    element.elements = [];
    if (node.value) {
      element.elements.push({ type: 'text', text: node.value });
    }

    if (node.children.length > 0) {
      element.elements.push(...buildXmlFromEditable(node.children));
    }

    return element;
  });
}

function deepCloneNode(node: EditableNode): EditableNode {
  return {
    ...node,
    attributes: { ...node.attributes },
    children: node.children.map(deepCloneNode)
  };
}

function findNodeById(nodes: EditableNode[], id: string): EditableNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

function findParentNodes(nodes: EditableNode[], targetId: string, parentList: EditableNode[] = []): EditableNode[] | null {
  for (const node of nodes) {
    if (node.id === targetId) {
      return parentList;
    }
    const found = findParentNodes(node.children, targetId, [...parentList, node]);
    if (found) return found;
  }
  return null;
}

function regenerateIds(nodes: EditableNode[], parentPath: string = '', siblingCounts: Record<string, number> = {}): EditableNode[] {
  return nodes.map((node) => {
    const name = node.name;
    const count = (siblingCounts[name] || 0) + 1;
    siblingCounts[name] = count;
    const currentPath = parentPath ? `${parentPath}.${name}[${count}]` : `${name}[${count}]`;
    
    return {
      ...node,
      id: currentPath,
      path: currentPath,
      children: regenerateIds(node.children, currentPath, {})
    };
  });
}

export default function XmlEditor({ onNavigateToComparison }: XmlEditorProps) {
  const [xmlContent, setXmlContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<EditableNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Undo/Redo system
  const historyRef = useRef<EditableNode[][]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const saveToHistory = useCallback((newTree: EditableNode[]) => {
    const history = historyRef.current;
    const index = historyIndexRef.current;
    
    // Remove any history after current index (when new action after undo)
    const newHistory = history.slice(0, index + 1);
    newHistory.push(newTree.map(deepCloneNode));
    
    // Limit history size to 50 states
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      historyIndexRef.current = newHistory.length - 1;
    }
    
    historyRef.current = newHistory;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const history = historyRef.current;
    const index = historyIndexRef.current;
    
    if (index > 0) {
      historyIndexRef.current = index - 1;
      setTree(history[index - 1].map(deepCloneNode));
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(true);
    }
  }, []);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const index = historyIndexRef.current;
    
    if (index < history.length - 1) {
      historyIndexRef.current = index + 1;
      setTree(history[index + 1].map(deepCloneNode));
      setCanUndo(true);
      setCanRedo(historyIndexRef.current < history.length - 1);
    }
  }, []);

  useEffect(() => {
    if (!xmlContent.trim()) {
      setTree([]);
      setError(null);
      historyRef.current = [];
      historyIndexRef.current = -1;
      setCanUndo(false);
      setCanRedo(false);
      return;
    }

    try {
      const parsed = xml2js(xmlContent, { compact: false, ignoreDeclaration: true });
      const rootElements = (parsed as any).elements || [];
      const editableTree = buildEditableTree(rootElements);
      setTree(editableTree);
      setError(null);
      // Auto-expand first level
      if (editableTree.length > 0 && expandedPaths.size === 0) {
        setExpandedPaths(new Set(editableTree.map((n) => n.id)));
      }
      // Save initial state to history
      saveToHistory(editableTree);
    } catch (err) {
      setError((err as Error).message);
      setTree([]);
    }
  }, [xmlContent, saveToHistory]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (canRedo) redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  const handleFileLoad = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setFileName(file.name);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result?.toString() ?? '';
      setXmlContent(content);
      setIsLoading(false);
    };
    reader.onerror = () => {
      setError('Failed to read file');
      setIsLoading(false);
    };
    reader.readAsText(file);
  };

  const updateNodeValue = (id: string, value: string) => {
    const update = (nodes: EditableNode[]): EditableNode[] => {
      return nodes.map((node) => {
        if (node.id === id) {
          return { ...node, value };
        }
        return { ...node, children: update(node.children) };
      });
    };
    const newTree = update(tree);
    setTree(newTree);
    saveToHistory(newTree);
  };

  const updateNodeAttribute = (id: string, attrName: string, attrValue: string) => {
    const update = (nodes: EditableNode[]): EditableNode[] => {
      return nodes.map((node) => {
        if (node.id === id) {
          const newAttrs = { ...node.attributes };
          if (attrValue.trim()) {
            newAttrs[attrName] = attrValue;
          } else {
            delete newAttrs[attrName];
          }
          return { ...node, attributes: newAttrs };
        }
        return { ...node, children: update(node.children) };
      });
    };
    const newTree = update(tree);
    setTree(newTree);
    saveToHistory(newTree);
  };

  const deleteNode = (id: string) => {
    const remove = (nodes: EditableNode[]): EditableNode[] => {
      return nodes
        .filter((node) => node.id !== id)
        .map((node) => ({ ...node, children: remove(node.children) }));
    };
    const newTree = remove(tree);
    setTree(newTree);
    saveToHistory(newTree);
  };

  const duplicatePath = (id: string) => {
    const sourceNode = findNodeById(tree, id);
    if (!sourceNode) return;

    // Find parent nodes to determine insertion point
    const parentList = findParentNodes(tree, id);
    if (parentList === null) {
      // Root level node
      const duplicated = deepCloneNode(sourceNode);
      // Extract base name (e.g., "i1" from "i1[1]")
      const baseName = sourceNode.name.replace(/\[\d+\]$/, '');
      // Find next number
      const siblings = tree.filter(n => n.name.startsWith(baseName));
      const numbers = siblings.map(n => {
        const match = n.name.match(/\[(\d+)\]$/);
        return match ? parseInt(match[1]) : 0;
      });
      const nextNum = Math.max(0, ...numbers) + 1;
      duplicated.name = `${baseName}${nextNum}`;
      // Regenerate IDs for the duplicated subtree
      const newTree = [...tree, duplicated];
      const regenerated = regenerateIds(newTree);
      setTree(regenerated);
      saveToHistory(regenerated);
    } else {
      // Child node
      const parent = parentList[parentList.length - 1];
      const update = (nodes: EditableNode[]): EditableNode[] => {
        return nodes.map((node) => {
          if (node.id === parent.id) {
            const duplicated = deepCloneNode(sourceNode);
            const baseName = sourceNode.name.replace(/\[\d+\]$/, '');
            const siblings = node.children.filter(n => n.name.startsWith(baseName));
            const numbers = siblings.map(n => {
              const match = n.name.match(/\[(\d+)\]$/);
              return match ? parseInt(match[1]) : 0;
            });
            const nextNum = Math.max(0, ...numbers) + 1;
            duplicated.name = `${baseName}${nextNum}`;
            const newChildren = [...node.children, duplicated];
            // Regenerate IDs for parent's children
            const regeneratedChildren = regenerateIds(newChildren, node.path);
            return { ...node, children: regeneratedChildren };
          }
          return { ...node, children: update(node.children) };
        });
      };
      const newTree = update(tree);
      const regenerated = regenerateIds(newTree);
      setTree(regenerated);
      saveToHistory(regenerated);
    }
    
    // Expand the duplicated node
    const duplicatedNode = findNodeById(tree, id);
    if (duplicatedNode) {
      setExpandedPaths(new Set([...expandedPaths, duplicatedNode.id]));
    }
  };

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedPaths(newExpanded);
  };

  const handleDownload = () => {
    try {
      const xmlElements = buildXmlFromEditable(tree);
      const xmlObj = { elements: xmlElements };
      const xmlString = js2xml(xmlObj, { compact: false, spaces: 2 });
      const blob = new Blob([xmlString], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName ? `edited-${fileName}` : 'edited.xml';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Failed to generate XML: ${(err as Error).message}`);
    }
  };

  const renderNode = (node: EditableNode, level: number = 0) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedPaths.has(node.id);

    return (
      <div key={node.id} className="select-none">
        <div
          className="flex items-center gap-2 border-b border-slate-100 p-2 hover:bg-slate-50"
          style={{ paddingLeft: `${level * 20 + 8}px` }}
        >
          {hasChildren && (
            <button
              onClick={() => toggleExpand(node.id)}
              className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          {!hasChildren && <div className="w-5" />}

          <span className="font-mono text-sm font-semibold text-slate-700">{node.name}</span>

          <div className="ml-2 flex-1">
            <input
              type="text"
              value={node.value}
              onChange={(e) => updateNodeValue(node.id, e.target.value)}
              placeholder="(no text value)"
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono focus:border-[#2596be] focus:outline-none focus:ring-1 focus:ring-[#2596be]"
            />
          </div>

          <div className="flex gap-1">
            {Object.entries(node.attributes).map(([key, val]) => (
              <div key={key} className="flex items-center gap-1 rounded bg-[#2596be]/10 px-2 py-0.5 text-xs">
                <span className="font-semibold text-[#2596be]">{key}=</span>
                <input
                  type="text"
                  value={val}
                  onChange={(e) => updateNodeAttribute(node.id, key, e.target.value)}
                  className="w-20 rounded border border-[#2596be]/20 bg-white px-1 py-0.5 text-xs focus:border-[#2596be] focus:outline-none"
                />
              </div>
            ))}
          </div>

          <button
            onClick={() => duplicatePath(node.id)}
            className="rounded px-2 py-1 text-xs text-[#2596be] hover:bg-[#2596be]/10"
            title="Duplicate this path with all children"
          >
            Duplicate
          </button>

          <button
            onClick={() => deleteNode(node.id)}
            className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>

        {hasChildren && isExpanded && (
          <div>{node.children.map((child) => renderNode(child, level + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        <button
          onClick={onNavigateToComparison}
          className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          XML Comparison
        </button>
        <button className="border-b-2 border-[#2596be] px-4 py-2 text-sm font-semibold text-[#2596be]">
          XML Editor
        </button>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">XML Editor</h1>
          <p className="mt-1 text-sm text-slate-600">Upload, edit, and download XML files</p>
        </div>
        <div className="flex gap-3">
          <div className="flex gap-2">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Undo (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Redo (Ctrl+Y)"
            >
              ↷ Redo
            </button>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Load XML File
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              onChange={handleFileLoad}
              className="hidden"
            />
          </label>
          <button
            onClick={handleDownload}
            disabled={tree.length === 0}
            className="rounded-lg bg-[#2596be] px-4 py-2 text-sm font-medium text-white hover:bg-[#1e7a9a] disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Download Edited XML
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="mb-4 rounded-lg bg-[#2596be]/10 p-4 text-center text-sm text-[#2596be]">
          Loading XML file...
        </div>
      )}

      {fileName && !isLoading && (
        <div className="mb-4 rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-700">
          <span className="font-medium">File:</span> {fileName}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {tree.length === 0 && !isLoading && !error && (
        <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <svg className="mx-auto h-12 w-12 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <p className="mt-4 text-sm text-slate-600">Upload an XML file to start editing</p>
        </div>
      )}

      {tree.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="max-h-[600px] overflow-y-auto">
            {tree.map((node) => renderNode(node))}
          </div>
        </div>
      )}
    </div>
  );
}
