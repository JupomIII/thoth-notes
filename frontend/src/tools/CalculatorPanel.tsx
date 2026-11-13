import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Copy, X } from 'lucide-react';
import { loadMathEngine } from '../graph/plot';
import { Button, Segmented, TextInput, cx } from '../components/ui';

const SCIENTIFIC_KEYS: { label: string; insert: string; tone?: 'accent' | 'muted' }[] = [
  { label: '7', insert: '7' },
  { label: '8', insert: '8' },
  { label: '9', insert: '9' },
  { label: '÷', insert: '/' },
  { label: 'C', insert: '', tone: 'muted' },
  { label: '4', insert: '4' },
  { label: '5', insert: '5' },
  { label: '6', insert: '6' },
  { label: '×', insert: '*' },
  { label: '⌫', insert: '', tone: 'muted' },
  { label: '1', insert: '1' },
  { label: '2', insert: '2' },
  { label: '3', insert: '3' },
  { label: '−', insert: '-' },
  { label: '(', insert: '(' },
  { label: '0', insert: '0' },
  { label: '.', insert: '.' },
  { label: '=', insert: '', tone: 'accent' },
  { label: '+', insert: '+' },
  { label: ')', insert: ')' },
];

const FUNCTION_KEYS: { label: string; insert: string }[] = [
  { label: 'sin', insert: 'sin(' },
  { label: 'cos', insert: 'cos(' },
  { label: 'tan', insert: 'tan(' },
  { label: 'ln', insert: 'log(' },
  { label: 'log', insert: 'log10(' },
  { label: '√', insert: 'sqrt(' },
  { label: 'x²', insert: '^2' },
  { label: 'xʸ', insert: '^' },
  { label: 'π', insert: 'pi' },
  { label: 'e', insert: 'e' },
  { label: '!', insert: '!' },
  { label: 'asin', insert: 'asin(' },
];

function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return 'undefined';
  if (Math.abs(value) >= 1e12 || (Math.abs(value) < 1e-6 && value !== 0)) return value.toExponential(6);
  const rounded = Number.parseFloat(value.toPrecision(12));
  return String(rounded);
}

/** Converts a plain calculator expression into presentable LaTeX. */
function expressionToLatex(expression: string): string {
  return expression
    .replace(/\*/g, ' \\times ')
    .replace(/\bpi\b/g, '\\pi')
    .replace(/\bsqrt\(/g, '\\sqrt{')
    .replace(/\bsin\(/g, '\\sin(')
    .replace(/\bcos\(/g, '\\cos(')
    .replace(/\btan\(/g, '\\tan(')
    .replace(/\blog\(/g, '\\ln(')
    .replace(/\blog10\(/g, '\\log(');
}

const CONVERSIONS: Record<string, { units: Record<string, number> }> = {
  Length: { units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048 } },
  Area: { units: { 'mm²': 1e-6, 'cm²': 1e-4, 'm²': 1 } },
  Volume: { units: { 'mm³': 1e-9, 'cm³': 1e-6, 'm³': 1, L: 0.001 } },
  Mass: { units: { mg: 1e-6, g: 1e-3, kg: 1, t: 1000 } },
  Force: { units: { N: 1, kN: 1000 } },
  Pressure: { units: { Pa: 1, kPa: 1000, MPa: 1e6, bar: 1e5 } },
  Energy: { units: { J: 1, kJ: 1000, Wh: 3600 } },
  Temperature: { units: { '°C': 1, '°F': 1, K: 1 } },
};

function toKelvin(value: number, unit: string): number {
  if (unit === '°C') return value + 273.15;
  if (unit === '°F') return ((value - 32) * 5) / 9 + 273.15;
  return value;
}

function fromKelvin(value: number, unit: string): number {
  if (unit === '°C') return value - 273.15;
  if (unit === '°F') return ((value - 273.15) * 9) / 5 + 32;
  return value;
}

export function CalculatorPanel({
  onInsertText,
  onInsertEquation,
  onClose,
}: {
  onInsertText: (text: string) => void;
  onInsertEquation: (latex: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'calculator' | 'convert'>('calculator');
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [degrees, setDegrees] = useState(true);
  const [history, setHistory] = useState<{ expression: string; result: string }[]>([]);
  const evaluateRef = useRef<((expression: string, scope: Record<string, unknown>) => unknown) | null>(null);

  useEffect(() => {
    void (async () => {
      await loadMathEngine();
      const module = await import('mathjs/number');
      evaluateRef.current = module.evaluate as unknown as (
        expression: string,
        scope: Record<string, unknown>,
      ) => unknown;
    })();
  }, []);

  const categories = Object.keys(CONVERSIONS);
  const [category, setCategory] = useState('Length');
  const units = Object.keys(CONVERSIONS[category]!.units);
  const [fromUnit, setFromUnit] = useState(units[0]!);
  const [toUnit, setToUnit] = useState(units[1] ?? units[0]!);
  const [amount, setAmount] = useState('1');
  const [precision, setPrecision] = useState('4');

  const radians = degrees ? Math.PI / 180 : 1;

  function compute(): void {
    const trimmed = expression.trim();
    if (!trimmed) return;
    try {
      const scope = {
        sin: (x: number) => Math.sin(x * radians),
        cos: (x: number) => Math.cos(x * radians),
        tan: (x: number) => Math.tan(x * radians),
        asin: (x: number) => (degrees ? Math.asin(x) / radians : Math.asin(x)),
        acos: (x: number) => (degrees ? Math.acos(x) / radians : Math.acos(x)),
        atan: (x: number) => (degrees ? Math.atan(x) / radians : Math.atan(x)),
      };
      const evaluator = evaluateRef.current;
      if (!evaluator) throw new Error('Calculator is still loading');
      const value = evaluator(trimmed, scope) as unknown;
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) throw new Error('Result is not a finite number');
      const text = trimNumber(numeric);
      setResult(text);
      setError(null);
      setHistory((current) => [{ expression: trimmed, result: text }, ...current].slice(0, 24));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not a valid expression');
      setResult(null);
    }
  }

  function pressKey(key: (typeof SCIENTIFIC_KEYS)[number]): void {
    if (key.label === 'C') {
      setExpression('');
      setResult(null);
      setError(null);
      return;
    }
    if (key.label === '⌫') {
      setExpression((current) => current.slice(0, -1));
      return;
    }
    if (key.label === '=') {
      compute();
      return;
    }
    setExpression((current) => `${current}${key.insert}`);
  }

  const conversion = (() => {
    const amountValue = Number(amount.replace(',', '.'));
    if (!Number.isFinite(amountValue)) return null;
    if (category === 'Temperature') {
      return fromKelvin(toKelvin(amountValue, fromUnit), toUnit);
    }
    const unitsMap = CONVERSIONS[category]!.units;
    const factorFrom = unitsMap[fromUnit];
    const factorTo = unitsMap[toUnit];
    if (!factorFrom || !factorTo) return null;
    return (amountValue * factorFrom) / factorTo;
  })();

  const precisionValue = Number(precision);
  const conversionText =
    conversion === null
      ? '—'
      : precision === 'auto'
        ? trimNumber(conversion)
        : conversion.toFixed(Number.isFinite(precisionValue) ? precisionValue : 4);

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be refused outside a secure context; the value is
      // still visible and can be selected by hand.
    }
  }

  return (
    <div className="animate-in absolute inset-x-0 bottom-0 z-40 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-2xl border border-line bg-paper-raised shadow-float sm:inset-x-3 sm:bottom-3 sm:rounded-2xl lg:inset-x-auto lg:right-4 lg:top-16 lg:w-[520px]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <Segmented
          options={[
            { value: 'calculator', label: 'Calculator' },
            { value: 'convert', label: 'Convert' },
          ]}
          value={tab}
          onChange={(value) => setTab(value)}
        />
        <button
          type="button"
          aria-label="Close calculator"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-paper-sunken"
        >
          <X size={17} strokeWidth={1.8} />
        </button>
      </div>

      {tab === 'calculator' ? (
        <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          <div className="rounded-lg border border-line bg-paper px-3 py-2">
            <div className="min-h-[22px] break-all font-mono text-[15px] text-ink">
              {expression || <span className="text-ink-faint">Enter an expression</span>}
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-[12px] uppercase tracking-wide text-ink-muted">Result</span>
              <span className="font-serif text-[22px] tabular-nums text-ink">{result ?? '—'}</span>
            </div>
            {error && <p className="mt-1 text-[11.5px] text-danger">{error}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <Segmented
              options={[
                { value: 'deg', label: 'Degrees' },
                { value: 'rad', label: 'Radians' },
              ]}
              value={degrees ? 'deg' : 'rad'}
              onChange={(value) => setDegrees(value === 'deg')}
            />
            <div className="ml-auto flex gap-1">
              <Button
                variant="secondary"
                className="h-8 px-2 text-[12px]"
                disabled={!result}
                onClick={() => result && onInsertText(result)}
              >
                Insert
              </Button>
              <Button
                variant="secondary"
                className="h-8 px-2 text-[12px]"
                disabled={!result}
                onClick={() =>
                  result && onInsertEquation(`${expressionToLatex(expression).trim()} = ${result}`)
                }
              >
                As equation
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-2"
                aria-label="Copy result"
                disabled={!result}
                onClick={() => result && void copy(result)}
              >
                <Copy size={14} strokeWidth={1.8} />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-6 gap-1">
            {FUNCTION_KEYS.map((key) => (
              <button
                key={key.label}
                type="button"
                onClick={() => setExpression((current) => `${current}${key.insert}`)}
                className="h-10 rounded-md border border-line bg-paper text-[12.5px] text-ink-soft hover:bg-paper-sunken"
              >
                {key.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-1">
            {SCIENTIFIC_KEYS.map((key) => (
              <button
                key={key.label}
                type="button"
                onClick={() => pressKey(key)}
                className={cx(
                  'h-12 rounded-md border text-[15px] transition-colors',
                  key.tone === 'accent'
                    ? 'border-accent bg-accent text-paper-raised'
                    : key.tone === 'muted'
                      ? 'border-line bg-paper-sunken text-ink-soft'
                      : 'border-line bg-paper text-ink hover:bg-paper-sunken',
                )}
              >
                {key.label}
              </button>
            ))}
          </div>

          {history.length > 0 && (
            <div className="rounded-lg border border-line">
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-[11.5px] font-medium uppercase tracking-wide text-ink-muted">History</span>
                <button
                  type="button"
                  onClick={() => setHistory([])}
                  className="text-[11.5px] text-ink-muted hover:text-ink"
                >
                  Clear
                </button>
              </div>
              <div className="thin-scroll max-h-40 overflow-y-auto">
                {history.map((entry, index) => (
                  <div
                    key={`${entry.expression}-${index}`}
                    className="flex items-center justify-between gap-3 border-b border-line/60 px-3 py-1.5 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExpression(entry.expression);
                        setResult(entry.result);
                      }}
                      className="min-w-0 flex-1 truncate text-left font-mono text-[12.5px] text-ink-soft"
                    >
                      {entry.expression}
                    </button>
                    <span className="tabular-nums text-[13px] text-ink">{entry.result}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="flex flex-wrap gap-1">
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setCategory(name);
                  const nextUnits = Object.keys(CONVERSIONS[name]!.units);
                  setFromUnit(nextUnits[0]!);
                  setToUnit(nextUnits[1] ?? nextUnits[0]!);
                }}
                className={cx(
                  'rounded-md border px-2 py-1 text-[12px]',
                  category === name
                    ? 'border-accent bg-accent-soft text-accent-strong'
                    : 'border-line bg-paper text-ink-soft',
                )}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-line bg-paper p-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-[11.5px] uppercase tracking-wide text-ink-muted" htmlFor="convert-amount">
                  Value
                </label>
                <TextInput
                  id="convert-amount"
                  value={amount}
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                  className="h-10 font-mono text-[14px]"
                />
              </div>
              <select
                value={fromUnit}
                onChange={(event) => setFromUnit(event.target.value)}
                aria-label="From unit"
                className="h-10 rounded-lg border border-line bg-paper-raised px-2 text-[13px]"
              >
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Swap units"
                onClick={() => {
                  setFromUnit(toUnit);
                  setToUnit(fromUnit);
                }}
                className="flex h-10 w-9 items-center justify-center rounded-lg border border-line text-ink-muted hover:bg-paper-sunken"
              >
                <ArrowLeftRight size={15} strokeWidth={1.8} />
              </button>
              <select
                value={toUnit}
                onChange={(event) => setToUnit(event.target.value)}
                aria-label="To unit"
                className="h-10 rounded-lg border border-line bg-paper-raised px-2 text-[13px]"
              >
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="text-[12px] uppercase tracking-wide text-ink-muted">Result</span>
              <span className="font-serif text-[22px] tabular-nums text-ink">
                {conversionText}
                <span className="ml-1 text-[13px] text-ink-muted">{toUnit}</span>
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1">
              <Segmented
                options={[
                  { value: '2', label: '2' },
                  { value: '4', label: '4' },
                  { value: '6', label: '6' },
                  { value: 'auto', label: 'Auto' },
                ]}
                value={precision}
                onChange={setPrecision}
              />
              <div className="ml-auto flex gap-1">
                <Button
                  variant="secondary"
                  className="h-8 px-2 text-[12px]"
                  onClick={() => onInsertText(`${amount} ${fromUnit} = ${conversionText} ${toUnit}`)}
                >
                  Insert
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-2 text-[12px]"
                  onClick={() =>
                    onInsertEquation(
                      `${amount}\\,\\text{${fromUnit}} = ${conversionText}\\,\\text{${toUnit}}`,
                    )
                  }
                >
                  As equation
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-2"
                  aria-label="Copy conversion"
                  onClick={() => void copy(`${conversionText} ${toUnit}`)}
                >
                  <Copy size={14} strokeWidth={1.8} />
                </Button>
              </div>
            </div>
          </div>

          <p className="px-1 text-[11.5px] leading-relaxed text-ink-muted">
            Exact SI factors. Temperature uses the thermodynamic scale, so 0 °C = 273.15 K = 32 °F.
          </p>
        </div>
      )}
    </div>
  );
}
