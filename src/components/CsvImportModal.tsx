import React, { useMemo, useState } from 'react';
import { Check, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import type { Customer, InventoryItem } from '../types';
import type { CsvCustomerInput, CsvInventoryInput } from '../services/firestoreOps';

interface CsvImportModalProps {
  existingCustomers: Customer[];
  existingInventory: InventoryItem[];
  onImportCustomers: (rows: CsvCustomerInput[]) => Promise<{ imported: number }>;
  onImportInventory: (rows: CsvInventoryInput[]) => Promise<{ imported: number }>;
  onClose: () => void;
}

type ImportMode = 'customers' | 'inventory';

const SAMPLE_CUSTOMERS_CSV = `name,phone,location,current_udhaar_balance,credit_limit
Gupta Kirana Mart,+91 98110 22334,Chawri Bazaar Delhi,8500,50000
Patel Provision Store,+91 98250 77889,Sardar Market,0,75000
Bansal Wholesale Depot,+91 99104 55661,Naya Bazaar,22000,100000`;

const SAMPLE_INVENTORY_CSV = `sku,name,unit,aliases,stock_qty,unit_price,reorder_threshold,supplier_name
DAL_TOOR_30,Toor Dal Arhar (30kg),bori,toor dal|arhar dal|dal,32,3900,10,Mahalaxmi Pulses Mill
TEA_GOLD_10,Tata Tea Gold Carton,peti,chai patti|tea|tata tea,18,4800,8,Kanan Devan Distributors
OIL_MUSTARD_15,Kachi Ghani Mustard Oil,tin,sarson tel|mustard oil|tel,24,2350,10,Agra Agro Mills`;

function parseCsvMatrix(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      if (row.some((c) => c.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((c) => c.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseNumber(val: string | undefined, fallback = 0): number {
  if (!val) return fallback;
  const cleaned = val.replace(/[₹,\s]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  existingCustomers,
  existingInventory,
  onImportCustomers,
  onImportInventory,
  onClose,
}) => {
  const [mode, setMode] = useState<ImportMode>('customers');
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const existingCustNames = useMemo(
    () => new Set(existingCustomers.map((c) => c.name.trim().toLowerCase())),
    [existingCustomers]
  );
  const existingSkus = useMemo(
    () => new Set(existingInventory.map((i) => i.sku.trim().toUpperCase())),
    [existingInventory]
  );

  const parsedCustomers = useMemo(() => {
    if (mode !== 'customers' || !csvText.trim()) return [];
    const matrix = parseCsvMatrix(csvText);
    if (matrix.length < 2) return [];
    const headers = matrix[0].map(normalizeHeader);
    const findIdx = (...candidates: string[]) =>
      headers.findIndex((h) => candidates.includes(h));

    const idxName = findIdx('name', 'customername', 'storename', 'shopname', 'trader');
    const idxPhone = findIdx('phone', 'mobile', 'contact', 'phonenumber');
    const idxLoc = findIdx('location', 'market', 'city', 'address', 'area');
    const idxBal = findIdx('currentudhaarbalance', 'udhaar', 'balance', 'openingbalance', 'due');
    const idxLimit = findIdx('creditlimit', 'limit', 'maxcredit');

    return matrix.slice(1).map((cols, rowIdx) => {
      const name = idxName >= 0 ? cols[idxName] || '' : cols[0] || '';
      const phone = idxPhone >= 0 ? cols[idxPhone] || '' : cols[1] || '';
      const location = idxLoc >= 0 ? cols[idxLoc] || '' : cols[2] || '';
      const balance = parseNumber(idxBal >= 0 ? cols[idxBal] : cols[3], 0);
      const limit = parseNumber(idxLimit >= 0 ? cols[idxLimit] : cols[4], 50000);

      const isDup = existingCustNames.has(name.trim().toLowerCase());
      const valid = name.trim().length > 0 && !isDup;
      const issue = !name.trim()
        ? 'Missing name'
        : isDup
        ? 'Already in Khata (skipped)'
        : null;

      return {
        rowNum: rowIdx + 2,
        valid,
        issue,
        data: {
          name: name.trim(),
          phone: phone.trim() || '0000000000',
          location: location.trim() || 'Local Market',
          current_udhaar_balance: Math.max(0, balance),
          credit_limit: Math.max(0, limit),
        } satisfies CsvCustomerInput,
      };
    });
  }, [csvText, existingCustNames, mode]);

  const parsedInventory = useMemo(() => {
    if (mode !== 'inventory' || !csvText.trim()) return [];
    const matrix = parseCsvMatrix(csvText);
    if (matrix.length < 2) return [];
    const headers = matrix[0].map(normalizeHeader);
    const findIdx = (...candidates: string[]) =>
      headers.findIndex((h) => candidates.includes(h));

    const idxSku = findIdx('sku', 'itemcode', 'code', 'itemsku');
    const idxName = findIdx('name', 'itemname', 'product', 'productname');
    const idxUnit = findIdx('unit', 'uom', 'pack');
    const idxAliases = findIdx('aliases', 'hinglishaliases', 'tags', 'keywords');
    const idxStock = findIdx('stockqty', 'stock', 'qty', 'quantity');
    const idxPrice = findIdx('unitprice', 'price', 'rate', 'mrp');
    const idxReorder = findIdx('reorderthreshold', 'reorder', 'reorderat', 'minstock');
    const idxSupplier = findIdx('suppliername', 'supplier', 'distributor', 'vendor');

    return matrix.slice(1).map((cols, rowIdx) => {
      const skuRaw = idxSku >= 0 ? cols[idxSku] || '' : cols[0] || '';
      const name = idxName >= 0 ? cols[idxName] || '' : cols[1] || '';
      const unit = idxUnit >= 0 ? cols[idxUnit] || '' : cols[2] || 'units';
      const aliasStr = idxAliases >= 0 ? cols[idxAliases] || '' : cols[3] || '';
      const stockQty = parseNumber(idxStock >= 0 ? cols[idxStock] : cols[4], 0);
      const unitPrice = parseNumber(idxPrice >= 0 ? cols[idxPrice] : cols[5], 0);
      const reorderThreshold = parseNumber(idxReorder >= 0 ? cols[idxReorder] : cols[6], 10);
      const supplierName =
        (idxSupplier >= 0 ? cols[idxSupplier] : cols[7]) || 'Wholesale Distributor';

      const cleanSku = skuRaw
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '_');
      const isDup = cleanSku.length >= 2 && existingSkus.has(cleanSku);
      const valid = name.trim().length > 0 && unitPrice > 0 && !isDup;
      const issue = !name.trim()
        ? 'Missing item name'
        : unitPrice <= 0
        ? 'Unit price must be > 0'
        : isDup
        ? 'SKU already exists (skipped)'
        : null;

      const aliases = aliasStr
        .split(/[|/;]/)
        .map((s) => s.trim())
        .filter(Boolean);

      return {
        rowNum: rowIdx + 2,
        valid,
        issue,
        data: {
          sku: cleanSku,
          name: name.trim(),
          unit: unit.trim() || 'units',
          aliases: aliases.length > 0 ? aliases : [name.trim().toLowerCase()],
          stock_qty: Math.max(0, stockQty),
          unit_price: unitPrice,
          reorder_threshold: Math.max(0, reorderThreshold),
          supplier_name: supplierName.trim() || 'Wholesale Distributor',
        } satisfies CsvInventoryInput,
      };
    });
  }, [csvText, existingSkus, mode]);

  const activeRows = mode === 'customers' ? parsedCustomers : parsedInventory;
  const validCount = activeRows.filter((r) => r.valid).length;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    setStatusMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ''));
    };
    reader.onerror = () => {
      setErrorMessage('Failed to read the selected CSV file.');
    };
    reader.readAsText(file);
  };

  const handleDownloadSample = () => {
    const content = mode === 'customers' ? SAMPLE_CUSTOMERS_CSV : SAMPLE_INVENTORY_CSV;
    const filename =
      mode === 'customers'
        ? 'bolkhata_customers_template.csv'
        : 'bolkhata_inventory_template.csv';
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleLoadSample = () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setCsvText(mode === 'customers' ? SAMPLE_CUSTOMERS_CSV : SAMPLE_INVENTORY_CSV);
  };

  const handleCommitImport = async () => {
    if (validCount === 0) return;
    setImporting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (mode === 'customers') {
        const rows = parsedCustomers.filter((r) => r.valid).map((r) => r.data);
        const res = await onImportCustomers(rows);
        setStatusMessage(`Imported ${res.imported} customer Khata accounts into Firestore.`);
      } else {
        const rows = parsedInventory.filter((r) => r.valid).map((r) => r.data);
        const res = await onImportInventory(rows);
        setStatusMessage(`Imported ${res.imported} inventory SKUs into Firestore.`);
      }
      setCsvText('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'CSV import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="bg-white border border-blue-200 rounded-xl p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-base font-semibold text-slate-900 inline-flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-blue-700" />
            Bootstrap Shop via CSV Import
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Upload or paste an existing customer ledger or godown product catalog CSV to write
            directly to Firestore.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-500 hover:text-slate-800 rounded-md hover:bg-slate-100"
          aria-label="Close Import Data panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode Switch + Template Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setMode('customers');
              setCsvText('');
              setStatusMessage(null);
              setErrorMessage(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === 'customers'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Customer List CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('inventory');
              setCsvText('');
              setStatusMessage(null);
              setErrorMessage(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === 'inventory'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Product Catalog CSV
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleLoadSample}
            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
          >
            Load Sample Rows
          </button>
          <button
            type="button"
            onClick={handleDownloadSample}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download CSV Template
          </button>
        </div>
      </div>

      {/* File Upload + Paste Box */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <label className="lg:col-span-4 border border-dashed border-slate-300 rounded-lg p-5 flex flex-col items-center justify-center text-center cursor-pointer hover:border-blue-600 hover:bg-blue-50/30 transition-colors">
          <Upload className="w-5 h-5 text-blue-700 mb-2" />
          <span className="text-xs font-semibold text-slate-800">Choose .CSV File</span>
          <span className="text-[11px] text-slate-500 mt-1">
            {mode === 'customers'
              ? 'Columns: name, phone, location, current_udhaar_balance, credit_limit'
              : 'Columns: sku, name, unit, aliases, stock_qty, unit_price, reorder_threshold, supplier_name'}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>

        <div className="lg:col-span-8">
          <textarea
            rows={5}
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setStatusMessage(null);
            }}
            placeholder={
              mode === 'customers'
                ? SAMPLE_CUSTOMERS_CSV
                : SAMPLE_INVENTORY_CSV
            }
            className="w-full px-3.5 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-700"
          />
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {errorMessage}
        </div>
      )}

      {statusMessage && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Validation Preview Table */}
      {activeRows.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-800">
              Preview ({validCount} ready to import · {activeRows.length - validCount} skipped/invalid)
            </span>
            <button
              type="button"
              disabled={validCount === 0 || importing}
              onClick={handleCommitImport}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-40 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              {importing ? 'Importing to Firestore...' : `Import ${validCount} Rows`}
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-white text-slate-500">
                  <th className="py-2 px-4">Row</th>
                  <th className="py-2 px-4">Name</th>
                  <th className="py-2 px-4">
                    {mode === 'customers' ? 'Market & Phone' : 'SKU & Unit'}
                  </th>
                  <th className="py-2 px-4 text-right">
                    {mode === 'customers' ? 'Udhaar / Limit' : 'Stock @ Rate'}
                  </th>
                  <th className="py-2 px-4 text-right">Validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mode === 'customers'
                  ? parsedCustomers.map((r) => (
                      <tr key={r.rowNum} className={r.valid ? 'bg-white' : 'bg-amber-50/40'}>
                        <td className="py-2 px-4 font-mono text-slate-500">#{r.rowNum}</td>
                        <td className="py-2 px-4 font-medium text-slate-900">
                          {r.data.name || '—'}
                        </td>
                        <td className="py-2 px-4 text-slate-600">
                          {r.data.location} · {r.data.phone}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">
                          ₹{(r.data.current_udhaar_balance ?? 0).toLocaleString('en-IN')} / ₹
                          {(r.data.credit_limit ?? 0).toLocaleString('en-IN')}
                        </td>
                        <td
                          className={`py-2 px-4 text-right font-medium ${
                            r.valid ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {r.valid ? 'Ready' : r.issue}
                        </td>
                      </tr>
                    ))
                  : parsedInventory.map((r) => (
                      <tr key={r.rowNum} className={r.valid ? 'bg-white' : 'bg-amber-50/40'}>
                        <td className="py-2 px-4 font-mono text-slate-500">#{r.rowNum}</td>
                        <td className="py-2 px-4 font-medium text-slate-900">
                          {r.data.name || '—'}
                        </td>
                        <td className="py-2 px-4 text-slate-600 font-mono">
                          {r.data.sku || 'AUTO'} · {r.data.unit}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums">
                          {r.data.stock_qty} @ ₹{r.data.unit_price.toLocaleString('en-IN')}
                        </td>
                        <td
                          className={`py-2 px-4 text-right font-medium ${
                            r.valid ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {r.valid ? 'Ready' : r.issue}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
