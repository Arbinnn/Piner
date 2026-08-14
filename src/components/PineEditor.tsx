import { memo, useEffect, useRef } from 'react';
// The `editor.api` entry is the editor core only — the package root would also pull in every
// bundled language (and their megabyte-sized workers) that a Pine-only editor never uses.
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { Theme } from '../hooks/useTheme';

// Pine has no builtin Monaco language, so only the base editor worker is ever needed.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const KEYWORDS = [
  'if', 'else', 'for', 'to', 'by', 'while', 'switch', 'break', 'continue', 'return',
  'var', 'varip', 'and', 'or', 'not', 'true', 'false', 'na', 'import', 'export', 'type', 'method', 'enum',
];

const TYPES = ['int', 'float', 'bool', 'string', 'color', 'line', 'label', 'box', 'table', 'array', 'matrix', 'map', 'series', 'simple', 'const', 'input'];

const NAMESPACES = [
  'ta', 'math', 'str', 'array', 'matrix', 'map', 'color', 'line', 'label', 'box', 'table', 'request',
  'strategy', 'syminfo', 'timeframe', 'barstate', 'session', 'input', 'plot', 'chart', 'ticker', 'runtime', 'log',
];

const BUILTINS = [
  'open', 'high', 'low', 'close', 'volume', 'time', 'hl2', 'hlc3', 'ohlc4', 'hlcc4',
  'bar_index', 'last_bar_index', 'na', 'indicator', 'strategy', 'library', 'plot', 'plotshape',
  'plotchar', 'plotarrow', 'plotbar', 'plotcandle', 'hline', 'fill', 'bgcolor', 'barcolor', 'alert', 'alertcondition',
];

monaco.languages.register({ id: 'pine' });

monaco.languages.setLanguageConfiguration('pine', {
  comments: { lineComment: '//' },
  brackets: [['(', ')'], ['[', ']'], ['{', '}']],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
});

monaco.languages.setMonarchTokensProvider('pine', {
  keywords: KEYWORDS,
  typeKeywords: TYPES,
  builtins: BUILTINS,
  namespaces: NAMESPACES,
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/'([^'\\]|\\.)*'/, 'string'],
      [/\b\d+(\.\d+)?([eE][-+]?\d+)?\b/, 'number'],
      [/#[0-9a-fA-F]{6,8}\b/, 'number.hex'],
      // A named argument (`color=`, `title=`) reads as a parameter, not a variable.
      [/[a-zA-Z_]\w*(?=\s*=[^=])/, 'variable.parameter'],
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@namespaces': 'namespace',
            '@builtins': 'predefined',
            '@default': 'identifier',
          },
        },
      ],
      [/[=<>!?:+\-*/%]+/, 'operator'],
    ],
  },
});

/** Themes mirror the app's CSS tokens so the editor reads as part of the panel, not a widget in it. */
const SHARED: Pick<monaco.editor.IStandaloneThemeData, 'inherit' | 'rules'> = { inherit: true, rules: [] };

monaco.editor.defineTheme('pine-dark', {
  ...SHARED,
  base: 'vs-dark',
  rules: [
    { token: 'comment', foreground: '6b6f76', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f5a623' },
    { token: 'type', foreground: '7fb7d4' },
    { token: 'namespace', foreground: 'c7a2e0' },
    { token: 'predefined', foreground: '8fc98f' },
    { token: 'variable.parameter', foreground: '9aa0a8' },
    { token: 'string', foreground: 'd6a76a' },
    { token: 'number', foreground: 'd6a76a' },
    { token: 'number.hex', foreground: 'd6a76a' },
    { token: 'operator', foreground: 'a8adb5' },
  ],
  colors: {
    'editor.background': '#0e1013',
    'editor.foreground': '#e9e7e0',
    'editorLineNumber.foreground': '#4a4e55',
    'editorLineNumber.activeForeground': '#83868c',
    'editor.lineHighlightBackground': '#14171b',
    'editorCursor.foreground': '#f5a623',
    'editor.selectionBackground': '#2a3038',
    'editorIndentGuide.background1': '#1d2126',
    'editorGutter.background': '#0e1013',
  },
});

monaco.editor.defineTheme('pine-light', {
  ...SHARED,
  base: 'vs',
  rules: [
    { token: 'comment', foreground: '8a877c', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'b3690f' },
    { token: 'type', foreground: '1d6a8c' },
    { token: 'namespace', foreground: '7a3fa6' },
    { token: 'predefined', foreground: '2f7a3f' },
    { token: 'variable.parameter', foreground: '6c6a63' },
    { token: 'string', foreground: '9a5b12' },
    { token: 'number', foreground: '9a5b12' },
    { token: 'number.hex', foreground: '9a5b12' },
    { token: 'operator', foreground: '4a4840' },
  ],
  colors: {
    'editor.background': '#f2efe7',
    'editor.foreground': '#1b1a17',
    'editorLineNumber.foreground': '#a8a498',
    'editorLineNumber.activeForeground': '#6c6a63',
    'editor.lineHighlightBackground': '#ece7db',
    'editorCursor.foreground': '#b3690f',
    'editor.selectionBackground': '#ded7c5',
    'editorIndentGuide.background1': '#e2ddcf',
    'editorGutter.background': '#f2efe7',
  },
});

interface PineEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  theme: Theme;
}

function PineEditorImpl({ value, onChange, onRun, theme }: PineEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // Latest callbacks, so the editor is created once and never rebuilt when a prop identity changes.
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const editor = monaco.editor.create(host, {
      value,
      language: 'pine',
      theme: theme === 'light' ? 'pine-light' : 'pine-dark',
      automaticLayout: true,
      fontFamily: "'IBM Plex Mono', ui-monospace, 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.65,
      tabSize: 2,
      insertSpaces: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      padding: { top: 12, bottom: 12 },
      smoothScrolling: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      overviewRulerLanes: 0,
      fixedOverflowWidgets: true,
    });
    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());

    return () => {
      sub.dispose();
      editor.getModel()?.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only push external changes (a loaded script) — writing back what the user just typed would
  // reset the cursor on every keystroke.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(theme === 'light' ? 'pine-light' : 'pine-dark');
  }, [theme]);

  return <div className="pine-editor" ref={hostRef} aria-label="Pine Script editor" />;
}

export const PineEditor = memo(PineEditorImpl);
