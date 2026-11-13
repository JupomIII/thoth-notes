import { useEffect, useState } from 'react';
import { cx } from '../components/ui';
import { MathView, preloadKatex } from './MathView';

/**
 * The floating mathematical keyboard. Every key inserts LaTeX at the caret of
 * the MathLive field, so the symbol panels stay useful for every construct the
 * editor supports rather than pretending to be a physical keyboard.
 */

type Key = { latex: string; label?: string; wide?: boolean; title?: string };

const BASIC: Key[] = [
  { latex: '+', title: 'Plus' },
  { latex: '-', title: 'Minus' },
  { latex: '\\times', title: 'Multiply' },
  { latex: '\\div', title: 'Divide' },
  { latex: '=', title: 'Equals' },
  { latex: '\\neq', title: 'Not equal' },
  { latex: '\\approx', title: 'Approximately' },
  { latex: '<', title: 'Less than' },
  { latex: '>', title: 'Greater than' },
  { latex: '\\leq', title: 'At most' },
  { latex: '\\geq', title: 'At least' },
  { latex: '\\pm', title: 'Plus or minus' },
  { latex: '\\cdot', title: 'Dot product' },
  { latex: '\\%', title: 'Percent' },
  { latex: '!', title: 'Factorial' },
  { latex: '(', title: 'Open bracket' },
  { latex: ')', title: 'Close bracket' },
  { latex: '[', title: 'Open square bracket' },
  { latex: ']', title: 'Close square bracket' },
  { latex: '\\left|#@\\right|', title: 'Absolute value' },
  { latex: '\\frac{#@}{#@}', title: 'Fraction', wide: true },
  { latex: '\\sqrt{#@}', title: 'Square root' },
  { latex: '\\sqrt[#@]{#@}', title: 'nth root' },
  { latex: '^{#@}', title: 'Power' },
  { latex: '_{#@}', title: 'Subscript' },
];

const GREEK: Key[] = [
  { latex: '\\alpha', title: 'alpha' },
  { latex: '\\beta', title: 'beta' },
  { latex: '\\gamma', title: 'gamma' },
  { latex: '\\delta', title: 'delta' },
  { latex: '\\epsilon', title: 'epsilon' },
  { latex: '\\varepsilon', title: 'varepsilon' },
  { latex: '\\zeta', title: 'zeta' },
  { latex: '\\eta', title: 'eta' },
  { latex: '\\theta', title: 'theta' },
  { latex: '\\lambda', title: 'lambda' },
  { latex: '\\mu', title: 'mu' },
  { latex: '\\nu', title: 'nu' },
  { latex: '\\pi', title: 'pi' },
  { latex: '\\rho', title: 'rho' },
  { latex: '\\sigma', title: 'sigma' },
  { latex: '\\tau', title: 'tau' },
  { latex: '\\phi', title: 'phi' },
  { latex: '\\varphi', title: 'varphi' },
  { latex: '\\chi', title: 'chi' },
  { latex: '\\psi', title: 'psi' },
  { latex: '\\omega', title: 'omega' },
  { latex: '\\Delta', title: 'Delta' },
  { latex: '\\Sigma', title: 'Sigma' },
  { latex: '\\Omega', title: 'Omega' },
  { latex: '\\Gamma', title: 'Gamma' },
  { latex: '\\Lambda', title: 'Lambda' },
  { latex: '\\Phi', title: 'Phi' },
  { latex: '\\Theta', title: 'Theta' },
];

const CALCULUS: Key[] = [
  { latex: '\\int', title: 'Integral' },
  { latex: '\\int_{#@}^{#@}', title: 'Definite integral', wide: true },
  { latex: '\\iint', title: 'Double integral' },
  { latex: '\\oint', title: 'Contour integral' },
  { latex: '\\frac{d}{dx}', title: 'Derivative', wide: true },
  { latex: '\\frac{dy}{dx}', title: 'dy by dx' },
  { latex: '\\frac{\\partial}{\\partial x}', title: 'Partial derivative' },
  { latex: '\\frac{\\partial^2 f}{\\partial x^2}', title: 'Second partial' },
  { latex: '\\lim_{x \\to #@}', title: 'Limit', wide: true },
  { latex: '\\lim_{x \\to \\infty}', title: 'Limit at infinity' },
  { latex: '\\sum_{k=1}^{n}', title: 'Summation' },
  { latex: '\\prod_{k=1}^{n}', title: 'Product' },
  { latex: '\\infty', title: 'Infinity' },
  { latex: '\\Delta x', title: 'Delta x' },
  { latex: '\\to', title: 'Tends to' },
  { latex: "f'(x)", title: 'f prime' },
  { latex: "f''(x)", title: 'Second derivative' },
  { latex: '\\dot{x}', title: 'Time derivative' },
  { latex: 'dx', title: 'dx' },
];

const ALGEBRA: Key[] = [
  { latex: 'x^2', title: 'x squared' },
  { latex: 'x^n', title: 'x to the n' },
  { latex: 'x_n', title: 'x sub n' },
  { latex: '(#@)^2', title: 'Squared bracket' },
  { latex: '\\frac{a}{b}', title: 'a over b' },
  { latex: '\\sqrt{x}', title: 'Root of x' },
  { latex: '\\log_{b}(x)', title: 'Logarithm' },
  { latex: '\\ln(x)', title: 'Natural log' },
  { latex: '\\exp(x)', title: 'Exponential' },
  { latex: 'e^{x}', title: 'e to the x' },
  { latex: '\\equiv', title: 'Identical' },
  { latex: '\\propto', title: 'Proportional' },
  { latex: '\\therefore', title: 'Therefore' },
  { latex: '\\begin{cases}#@ \\\\ #@\\end{cases}', title: 'Cases', wide: true },
  { latex: '\\begin{aligned}a &= #@ \\\\ b &= #@\\end{aligned}', title: 'Aligned system', wide: true },
  { latex: '|x|', title: 'Modulus' },
  { latex: '\\binom{n}{k}', title: 'Binomial' },
  { latex: '\\overline{x}', title: 'Mean' },
];

const TRIG: Key[] = [
  { latex: '\\sin', title: 'sin' },
  { latex: '\\cos', title: 'cos' },
  { latex: '\\tan', title: 'tan' },
  { latex: '\\csc', title: 'csc' },
  { latex: '\\sec', title: 'sec' },
  { latex: '\\cot', title: 'cot' },
  { latex: '\\arcsin', title: 'arcsin' },
  { latex: '\\arccos', title: 'arccos' },
  { latex: '\\arctan', title: 'arctan' },
  { latex: '\\sin^2', title: 'sin squared' },
  { latex: '\\cos^2', title: 'cos squared' },
  { latex: '\\theta', title: 'theta' },
  { latex: '\\pi', title: 'pi' },
  { latex: '\\frac{\\pi}{2}', title: 'pi over 2' },
  { latex: '2\\pi', title: 'two pi' },
  { latex: '^\\circ', title: 'Degrees' },
];

const LINEAR: Key[] = [
  { latex: '\\vec{v}', title: 'Vector' },
  { latex: '\\hat{u}', title: 'Unit vector' },
  { latex: '\\mathbf{A}', title: 'Matrix A' },
  { latex: 'A^T', title: 'Transpose' },
  { latex: 'A^{-1}', title: 'Inverse' },
  { latex: '\\det(A)', title: 'Determinant' },
  { latex: '\\lambda', title: 'Eigenvalue' },
  { latex: '\\|v\\|', title: 'Norm' },
  { latex: '\\langle u, v \\rangle', title: 'Inner product', wide: true },
  { latex: 'u \\cdot v', title: 'Dot product' },
  { latex: 'u \\times v', title: 'Cross product' },
  { latex: '\\mathbf{I}', title: 'Identity' },
  { latex: '\\mathbb{R}^n', title: 'R n' },
  { latex: '\\text{span}', title: 'Span' },
];

const MATRICES: Key[] = [
  { latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', title: '2 by 2 matrix', wide: true },
  { latex: '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}', title: '3 by 3 matrix', wide: true },
  { latex: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', title: 'Square bracket matrix', wide: true },
  { latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}', title: 'Determinant bars', wide: true },
  { latex: '\\begin{cases} x + y = #@ \\\\ x - y = #@ \\end{cases}', title: 'System of equations', wide: true },
];

export const MATH_CATEGORIES: { id: string; label: string; keys: Key[] }[] = [
  { id: 'basic', label: 'Basic', keys: BASIC },
  { id: 'greek', label: 'Greek', keys: GREEK },
  { id: 'calculus', label: 'Calculus', keys: CALCULUS },
  { id: 'algebra', label: 'Algebra', keys: ALGEBRA },
  { id: 'trig', label: 'Trigonometry', keys: TRIG },
  { id: 'linear', label: 'Linear algebra', keys: LINEAR },
  { id: 'matrices', label: 'Matrices', keys: MATRICES },
];

export function MathKeyboard({ onInsert }: { onInsert: (latex: string) => void }) {
  const [category, setCategory] = useState('basic');
  useEffect(() => {
    void preloadKatex();
  }, []);
  const keys = MATH_CATEGORIES.find((item) => item.id === category)?.keys ?? BASIC;

  return (
    <div className="rounded-xl border border-line bg-paper-raised">
      <div className="thin-scroll flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
        {MATH_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategory(item.id)}
            className={cx(
              'whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] transition-colors',
              category === item.id
                ? 'bg-accent-soft text-accent-strong'
                : 'text-ink-muted hover:bg-paper-sunken',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid max-h-[176px] grid-cols-6 gap-1 overflow-y-auto p-2 sm:grid-cols-9">
        {keys.map((key) => (
          <button
            key={`${category}-${key.title ?? key.latex}`}
            type="button"
            title={key.title ?? key.latex}
            aria-label={key.title ?? key.latex}
            onClick={() => onInsert(key.latex.replace(/#@/g, '\\placeholder{}'))}
            className={cx(
              'flex h-11 items-center justify-center rounded-md border border-line bg-paper text-ink transition-colors hover:border-line-strong hover:bg-paper-sunken',
              key.wide && 'col-span-2',
            )}
          >
            <MathView latex={key.latex.replace(/#@/g, '\\Box')} size={15} display={false} />
          </button>
        ))}
      </div>
    </div>
  );
}
