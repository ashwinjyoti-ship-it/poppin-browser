import type { CompareMatrix } from '../../shared/compare-board';

interface CompareBoardProps {
  matrix: CompareMatrix;
  title?: string;
}

/**
 * Structured Diff/Compare board: options as columns, attributes as rows.
 * Renders a matrix instead of relying on freeform prose alone.
 */
export function CompareBoard({ matrix, title = 'Compare' }: CompareBoardProps) {
  return (
    <section className="compare-board" aria-label={title}>
      <div className="compare-board-heading">
        <span className="eyebrow">Compare board</span>
        <h3>{title}</h3>
      </div>
      <div className="compare-board-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Attribute</th>
              {matrix.options.map((option) => (
                <th key={option} scope="col">{option}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.cells.map((cell, index) => (
                  <td key={`${row.label}-${matrix.options[index] ?? index}`}>{cell || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
