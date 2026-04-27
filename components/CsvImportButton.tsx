'use client';

import { useRef } from 'react';
import type { ExpenseCategory } from '@/lib/finance-types';

interface ParsedExpense {
  title: string;
  amount: number;
  category: ExpenseCategory;
  spentOn: string;
  notes?: string;
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, '').trim()) || 0;
}

function mapCategory(_csvCategory: string, _place: string): ExpenseCategory {
  return 'maintenance';
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function buildExpenseNotes(place: string, note: string): string | undefined {
  const segments: string[] = [];
  if (place) segments.push(`Place: ${toTitleCase(place)}`);
  if (note && note !== '-' && note !== "'-") segments.push(`Note: ${note}`);
  return segments.length > 0 ? segments.join(' | ') : undefined;
}

function parseAxioCsv(text: string): ParsedExpense[] {
  const lines = text.split('\n');
  const dataStart = lines.findIndex((l) => l.trim().startsWith('DATE') || l.trim().startsWith('"DATE"'));
  if (dataStart === -1) return [];

  const results: ParsedExpense[] = [];
  for (let i = dataStart + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCsvLine(line);
    if (cols.length < 9) continue;

    const [date, , place, amountRaw, drCr, , expense, , rawCategory, , note] = cols;

    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    if (drCr !== 'DR') continue;
    if (expense !== 'Yes') continue;
    if (place.toUpperCase() === 'NET BANKING') continue;

    const amount = parseAmount(amountRaw);
    if (amount <= 0) continue;

    const expenseName = toTitleCase(rawCategory || 'Unknown');

    results.push({
      title: expenseName,
      amount,
      category: mapCategory(rawCategory, place),
      spentOn: date,
      notes: buildExpenseNotes(place, note),
    });
  }
  return results;
}

export function CsvImportButton({
  onParsed,
  isPending,
  status,
}: {
  onParsed: (expenses: ParsedExpense[]) => void;
  isPending: boolean;
  status: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      onParsed(parseAxioCsv(text));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
      <button
        type="button"
        className="chip-soft text-xs font-bold"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        {isPending ? 'Importing…' : '↑ Import CSV'}
      </button>
      {status && <span className="text-xs font-semibold text-duored-muted">{status}</span>}
    </div>
  );
}

export type { ParsedExpense };
