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

function parseAxioCsv(text: string): ParsedExpense[] {
  const lines = text.split('\n');
  const dataStart = lines.findIndex((l) => l.startsWith('"DATE"'));
  if (dataStart === -1) return [];

  const results: ParsedExpense[] = [];
  for (let i = dataStart + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('"",""')) continue;

    const cols = line.split('","').map((c) => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 9) continue;

    const [date, , place, amountRaw, drCr, , expense, , category, , note] = cols;

    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    if (drCr !== 'DR') continue;
    if (expense !== 'Yes') continue;
    if (place.toUpperCase() === 'NET BANKING') continue;

    const amount = parseAmount(amountRaw);
    if (amount <= 0) continue;

    results.push({
      title: toTitleCase(place),
      amount,
      category: mapCategory(category, place),
      spentOn: date,
      notes: note && note !== '-' && note !== "'-" ? note : undefined,
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
