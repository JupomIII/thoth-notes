import { Calculator, FunctionSquare, Image as ImageIcon, Sigma, Table2, Type } from 'lucide-react';
import { useEffect } from 'react';
import { Modal, cx } from './ui';
import { MathView, preloadKatex } from '../rich/MathView';

const FORMULAS: { name: string; latex: string }[] = [
  { name: 'Quadratic formula', latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
  { name: 'Pythagoras', latex: 'a^2 + b^2 = c^2' },
  { name: 'Derivative definition', latex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}" },
  { name: 'Power rule', latex: '\\frac{d}{dx} x^n = n x^{n-1}' },
  { name: 'Integral of a power', latex: '\\int x^n dx = \\frac{x^{n+1}}{n+1} + C' },
  { name: 'Euler identity', latex: 'e^{i\\pi} + 1 = 0' },
  { name: 'Normal distribution', latex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}' },
  { name: 'Kinematics', latex: 'v = u + at' },
  { name: 'Energy', latex: 'E = \\frac{1}{2} m v^2' },
  { name: 'Ohm’s law', latex: 'V = IR' },
  { name: 'Ideal gas', latex: 'PV = nRT' },
  { name: 'Circle area', latex: 'A = \\pi r^2' },
  { name: 'Trigonometric identity', latex: '\\sin^2\\theta + \\cos^2\\theta = 1' },
  { name: 'Compound interest', latex: 'A = P\\left(1 + \\frac{r}{n}\\right)^{nt}' },
  { name: 'Bayes', latex: 'P(A|B) = \\frac{P(B|A)P(A)}{P(B)}' },
  { name: 'Matrix inverse', latex: 'A^{-1} = \\frac{1}{\\det A} \\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}' },
];

const INSERTS: { id: string; label: string; hint: string; icon: typeof Sigma }[] = [
  { id: 'equation', label: 'Equation', hint: 'LaTeX, stays editable', icon: Sigma },
  { id: 'graph', label: 'Graph', hint: 'Live coordinate system', icon: FunctionSquare },
  { id: 'table', label: 'Table', hint: 'Editable rows and columns', icon: Table2 },
  { id: 'text', label: 'Text', hint: 'Typed note on the page', icon: Type },
  { id: 'image', label: 'Image', hint: 'From Photos or Files', icon: ImageIcon },
  { id: 'calculator', label: 'Calculator', hint: 'Scientific and unit conversion', icon: Calculator },
];

export function InsertSheet({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (kind: string, latex?: string) => void;
}) {
  useEffect(() => {
    if (open) void preloadKatex();
  }, [open]);

  return (
    <Modal open={open} title="Insert" description="Everything stays an editable object on the page." onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {INSERTS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onInsert(item.id)}
            className={cx(
              'flex flex-col items-start gap-1 rounded-lg border border-line bg-paper px-3 py-3 text-left transition-colors hover:border-line-strong hover:bg-paper-sunken',
            )}
          >
            <item.icon size={17} strokeWidth={1.7} className="text-accent-strong" />
            <span className="text-[14px] text-ink">{item.label}</span>
            <span className="text-[11.5px] leading-snug text-ink-muted">{item.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-muted">Formula library</h3>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {FORMULAS.map((formula) => (
            <button
              key={formula.name}
              type="button"
              onClick={() => onInsert('equation', formula.latex)}
              className="flex flex-col items-start gap-1 rounded-lg border border-line bg-paper-raised px-3 py-2 text-left hover:border-line-strong"
            >
              <span className="text-[11.5px] text-ink-muted">{formula.name}</span>
              <span className="katex-preview max-w-full overflow-hidden text-ink">
                <MathView latex={formula.latex} size={15} display={false} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
