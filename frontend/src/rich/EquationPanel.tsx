import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import 'mathlive/fonts.css';
import type { EquationPlacement } from '../storage/types';
import { Button, Segmented, TextInput, cx } from '../components/ui';
import { MathKeyboard } from './MathKeyboard';

export interface EquationDraft {
  latex: string;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  label: string;
}

interface MathfieldLike extends HTMLElement {
  value: string;
  insert(latex: string): boolean;
  executeCommand(command: string): boolean;
  focus(): void;
}

/** Removes editor-only placeholders so stored LaTeX always renders. */
export function cleanLatex(latex: string): string {
  return latex.replace(/\\placeholder\{\}/g, '').replace(/\s+/g, ' ').trim();
}

const SIZES = [
  { value: '18', label: 'S' },
  { value: '24', label: 'M' },
  { value: '32', label: 'L' },
  { value: '42', label: 'XL' },
];

export function EquationPanel({
  initial,
  initialLatex,
  onCommit,
  onClose,
}: {
  initial?: EquationPlacement | null;
  initialLatex?: string;
  onCommit: (draft: EquationDraft) => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldLike | null>(null);
  const [latex, setLatex] = useState(initial?.latex ?? initialLatex ?? '');
  const [fontSize, setFontSize] = useState(initial?.fontSize ?? 26);
  const [align, setAlign] = useState<'left' | 'center' | 'right'>(initial?.align ?? 'left');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let field: MathfieldLike | null = null;

    void (async () => {
      const module = await import('mathlive');
      if (disposed) return;
      const Element = (module as unknown as { MathfieldElement: typeof HTMLElement & {
        fontsDirectory: string | null;
        soundsDirectory: string | null;
      } }).MathfieldElement;
      Element.fontsDirectory = null;
      Element.soundsDirectory = null;
      if (!hostRef.current) return;
      field = new (Element as unknown as new () => MathfieldLike)();
      field.value = initial?.latex ?? initialLatex ?? '';
      field.style.width = '100%';
      field.style.border = 'none';
      field.style.outline = 'none';
      field.style.background = 'transparent';
      field.style.fontSize = '22px';
      field.style.padding = '6px 2px';
      field.setAttribute('virtual-keyboard-mode', 'manual');
      field.setAttribute('aria-label', 'Equation');
      field.addEventListener('input', () => {
        setLatex(field?.value ?? '');
      });
      hostRef.current.replaceChildren(field);
      fieldRef.current = field;
      setReady(true);
      window.setTimeout(() => field?.focus(), 60);
    })();

    return () => {
      disposed = true;
      fieldRef.current = null;
      field?.remove();
    };
    // The mathfield is created once; its value is managed imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function insert(latexSnippet: string): void {
    const field = fieldRef.current;
    if (!field) {
      setLatex((current) => `${current}${latexSnippet.replace(/\\placeholder\{\}/g, '')}`);
      return;
    }
    field.insert(latexSnippet);
    field.executeCommand('moveToNextPlaceholder');
    setLatex(field.value);
    field.focus();
  }

  const cleaned = cleanLatex(latex);

  return (
    <div className="animate-in relative z-40 flex max-h-[68dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-paper-raised shadow-float">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="font-serif text-[17px] text-ink">Equation</h2>
          <span className="text-[11.5px] text-ink-muted">LaTeX stays editable</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-9 px-3 text-[13px]"
            disabled={!ready || cleaned.length === 0}
            onClick={() => onCommit({ latex: cleaned, fontSize, color: initial?.color ?? '#1f1d1a', align, label: label.trim() })}
          >
            {initial ? 'Update' : 'Insert'}
          </Button>
          <button
            type="button"
            aria-label="Close equation editor"
            onClick={onClose}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-paper-sunken"
          >
            <X size={17} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="thin-scroll flex-1 space-y-2.5 overflow-y-auto p-3">
        <div
          ref={hostRef}
          className={cx(
            'flex min-h-[64px] items-center rounded-lg border border-line bg-paper px-2',
            !ready && 'animate-pulse',
          )}
        />
        {!ready && <p className="px-1 text-[12px] text-ink-muted">Loading the equation field…</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            options={SIZES}
            value={String(fontSize)}
            onChange={(value) => setFontSize(Number(value))}
          />
          <Segmented
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
            value={align}
            onChange={(value) => setAlign(value)}
          />
          <div className="min-w-[150px] flex-1">
            <TextInput
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Label (optional)"
              className="h-9 text-[13px]"
              aria-label="Equation label"
            />
          </div>
        </div>

        <MathKeyboard onInsert={insert} />
      </div>
    </div>
  );
}
