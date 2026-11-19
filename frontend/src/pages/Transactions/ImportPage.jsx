import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { PageHeader } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../hooks/useAuth.js';
import { importTransactions, listCategories } from '../../services/ledgerService.js';
import { parseCsv } from '../../utils/csv.js';
import { FIELDS, guessDateFormat, guessMapping, guessTypeMode, toImportRows } from '../../utils/importMapping.js';
import { formatMoney } from '../../utils/format.js';
import { CURRENCY_CODES } from '../../utils/options.js';

const MAX_FILE_ROWS = 5000;
const BATCH = 200; // keeps each request well under the API's body limit
const STATUS = { ready: ['income', 'Ready'], duplicate: ['warning', 'Already recorded'], error: ['expense', 'Problem'], imported: ['income', 'Imported'], skipped: ['neutral', 'Skipped'] };
const TYPE_MODES = [
  { value: 'column', label: 'From a type column' },
  { value: 'sign', label: 'Negative amounts are expenses' },
  { value: 'debitCredit', label: 'Separate money-out and money-in columns' },
  { value: 'EXPENSE', label: 'Every row is an expense' },
  { value: 'INCOME', label: 'Every row is income' },
];

// Sends the rows in batches; row numbers in the results count from the top of the file.
async function runInBatches(rows, options) {
  const summary = { total: 0, ready: 0, duplicate: 0, error: 0, imported: 0, skipped: 0 };
  const results = [];
  for (let start = 0; start < rows.length; start += BATCH) {
    const res = await importTransactions({ ...options, rows: rows.slice(start, start + BATCH) });
    for (const key of Object.keys(summary)) summary[key] += res.summary[key];
    results.push(...res.rows.map((row) => ({ ...row, row: row.row + start })));
  }
  return { summary, rows: results };
}

export function ImportPage() {
  const { user } = useAuth();
  const categories = useAsync(() => listCategories());
  const [file, setFile] = useState(null); // { name, headers, rows }
  const [mapping, setMapping] = useState(null);
  const [options, setOptions] = useState(null);
  const [fallback, setFallback] = useState({ EXPENSE: '', INCOME: '' });
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onFile(event) {
    const chosen = event.target.files?.[0];
    setError(null);
    setPreview(null);
    setDone(null);
    if (!chosen) return;
    if (chosen.size > 5 * 1024 * 1024) return setError('The file is larger than 5 MB. Split it into smaller files.');
    const parsed = parseCsv(await chosen.text());
    if (!parsed.headers.length || !parsed.rows.length) return setError('No rows found. The first line must hold the column names.');
    if (parsed.rows.length > MAX_FILE_ROWS) return setError(`The file has ${parsed.rows.length} rows; import at most ${MAX_FILE_ROWS} at a time.`);
    const guessed = guessMapping(parsed.headers);
    setFile({ name: chosen.name, ...parsed });
    setMapping(guessed);
    setOptions({
      dateFormat: guessDateFormat(parsed.rows.slice(0, 50).map((row) => row[guessed.date] ?? '')),
      typeMode: guessTypeMode(guessed),
      defaultCurrency: user?.baseCurrency ?? 'INR',
    });
  }

  const apiRows = useMemo(() => (file && mapping && options ? toImportRows(file.rows, mapping, options) : []), [file, mapping, options]);
  const fallbackCategories = Object.fromEntries(Object.entries(fallback).filter(([, id]) => id).map(([type, id]) => [type, Number(id)]));
  const missing = mapping && (mapping.date === -1 || mapping.description === -1
    || (options.typeMode === 'debitCredit' ? mapping.debit === -1 || mapping.credit === -1 : mapping.amount === -1)
    || (options.typeMode === 'column' && mapping.type === -1));

  const change = (setter) => (key) => (event) => {
    setPreview(null);
    setter((current) => ({ ...current, [key]: event.target.value === '' ? '' : (setter === setMapping ? Number(event.target.value) : event.target.value) }));
  };

  async function run(dryRun) {
    setError(null);
    setBusy(true);
    try {
      const result = await runInBatches(apiRows, { dryRun, skipDuplicates: !includeDuplicates, fallbackCategories });
      if (dryRun) setPreview(result);
      else {
        setDone(result);
        setPreview(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = (done ?? preview)?.rows.filter((row) => !problemsOnly || ['error', 'duplicate'].includes(row.status)) ?? [];
  const toImport = preview ? preview.summary.ready + (includeDuplicates ? preview.summary.duplicate : 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Import transactions" description="Bring in history from a spreadsheet or a bank-statement CSV file. Nothing is saved until you confirm.">
        <Button to="/transactions" variant="secondary">Back to transactions</Button>
      </PageHeader>
      {error && <Alert tone="error">{error}</Alert>}

      <Card as="section" aria-labelledby="import-file">
        <CardHeader title={<span id="import-file">1. Choose a file</span>} description="CSV with column names on the first line. FinTrack's own CSV export works as it is." />
        <CardBody>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-navy-200 p-6 text-center hover:border-navy-400 focus-within:border-navy-500">
            <FileUp className="h-6 w-6 text-navy-500" aria-hidden="true" />
            <span className="text-sm font-medium text-navy-800">{file ? `${file.name}: ${file.rows.length} rows` : 'Choose a CSV file'}</span>
            <span className="text-xs text-navy-500">Up to {MAX_FILE_ROWS} rows. The file is read in your browser.</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} aria-label="CSV file" />
          </label>
        </CardBody>
      </Card>

      {file && mapping && (
        <Card as="section" aria-labelledby="import-columns">
          <CardHeader title={<span id="import-columns">2. Check the columns</span>} description="Columns were matched by name. Change any that are wrong." />
          <CardBody className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((field) => (
                <Select key={field.key} label={`${field.label}${field.required ? ' *' : ''}`} value={mapping[field.key]} onChange={change(setMapping)(field.key)}>
                  <option value={-1}>Not in the file</option>
                  {file.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Column ${index + 1}`}</option>)}
                </Select>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Select label="Income or expense" value={options.typeMode} onChange={change(setOptions)('typeMode')}>
                {TYPE_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </Select>
              <Select label="Dates are written as" value={options.dateFormat} onChange={change(setOptions)('dateFormat')}>
                <option value="YMD">Year-month-day (2026-11-18)</option>
                <option value="DMY">Day/month/year (18/11/2026)</option>
                <option value="MDY">Month/day/year (11/18/2026)</option>
              </Select>
              <Select label="Currency when the file has none" value={options.defaultCurrency} onChange={change(setOptions)('defaultCurrency')}>
                {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
              </Select>
              {['EXPENSE', 'INCOME'].map((type) => (
                <Select
                  key={type} label={`${type === 'EXPENSE' ? 'Expense' : 'Income'} category when none matches`} value={fallback[type]}
                  onChange={(event) => { setPreview(null); setFallback((current) => ({ ...current, [type]: event.target.value })); }}
                >
                  <option value="">None: show as a problem</option>
                  {(categories.data ?? []).filter((c) => c.type === type).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              ))}
            </div>
            {missing && <Alert tone="warning">Choose the columns marked * and the amount column(s) for the way income and expenses are told apart.</Alert>}
            <Button onClick={() => run(true)} loading={busy && !preview} disabled={missing || busy}>Check {apiRows.length} rows</Button>
          </CardBody>
        </Card>
      )}

      {(preview || done) && (
        <Card as="section" aria-labelledby="import-results">
          <CardHeader
            title={<span id="import-results">{done ? 'Imported' : '3. Review and import'}</span>}
            description={done
              ? `${done.summary.imported} imported, ${done.summary.skipped} skipped, ${done.summary.error} with problems.`
              : `${preview.summary.ready} ready, ${preview.summary.duplicate} already recorded, ${preview.summary.error} with problems.`}
            action={(
              <label className="flex items-center gap-2 text-sm text-navy-700">
                <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} className="h-4 w-4 rounded border-navy-300" />
                Problems only
              </label>
            )}
          />
          <CardBody className="space-y-4">
            {preview && (
              <div className="flex flex-wrap items-center gap-4">
                {preview.summary.duplicate > 0 && (
                  <label className="flex items-center gap-2 text-sm text-navy-700">
                    <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} className="h-4 w-4 rounded border-navy-300" />
                    Import the {preview.summary.duplicate} already recorded as well
                  </label>
                )}
                <Button onClick={() => run(false)} loading={busy} disabled={busy || toImport === 0}>Import {toImport} transaction{toImport === 1 ? '' : 's'}</Button>
              </div>
            )}
            {done && <Alert tone="success">Done. <Link to="/transactions" className="font-medium underline">See your transactions</Link>.</Alert>}
            {/* Focusable so keyboard users can scroll the table sideways on small screens. */}
            <div className="overflow-x-auto rounded-lg focus-visible:outline-2" tabIndex={0} role="region" aria-label="Rows of the file">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">Rows of the file and what happens to each</caption>
                <thead className="text-xs uppercase tracking-wide text-navy-500">
                  <tr><th className="py-2 pr-3">Row</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Description</th><th className="py-2 pr-3">Category</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {shown.slice(0, 500).map((row) => {
                    const [tone, label] = STATUS[row.status];
                    return (
                      <tr key={row.row} className="align-top">
                        <td className="tabular py-2 pr-3 text-navy-500">{row.row}</td>
                        <td className="tabular py-2 pr-3">{row.date ?? apiRows[row.row - 1]?.date}</td>
                        <td className="py-2 pr-3">{row.description ?? apiRows[row.row - 1]?.description}</td>
                        <td className="py-2 pr-3">{row.category ?? '—'}</td>
                        <td className={`tabular py-2 pr-3 text-right ${row.type === 'INCOME' ? 'text-income' : 'text-navy-900'}`}>
                          {row.amount ? `${row.type === 'INCOME' ? '+' : '−'}${formatMoney(row.amount, row.currency)}` : apiRows[row.row - 1]?.amount || '—'}
                        </td>
                        <td className="py-2">
                          <Badge tone={tone}>{label}</Badge>
                          {row.errors?.map((message) => <p key={message} className="mt-1 text-xs text-expense">{message}</p>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shown.length > 500 && <p className="mt-2 text-xs text-navy-500">Showing the first 500 rows.</p>}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
