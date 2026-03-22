'use client';

import { useState } from 'react';
import { Pencil, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface EditableCalcFieldProps {
  label: string;
  autoValue: string | number | null;     // the auto-calculated value to display
  autoDisplay?: string;                  // formatted display string (optional)
  manualValue: string;                   // current manually entered value ('' = not set)
  onManualChange: (val: string) => void; // called when user edits manually
  onReset: () => void;                   // called when user resets to auto
  placeholder?: string;
  type?: string;
  step?: string;
  readOnly?: boolean;
  error?: string;
  hint?: string;                         // extra hint text below field
  className?: string;
}

export function EditableCalcField({
  label,
  autoValue,
  autoDisplay,
  manualValue,
  onManualChange,
  onReset,
  placeholder,
  type = 'text',
  step,
  error,
  hint,
}: EditableCalcFieldProps) {
  const [editing, setEditing] = useState(false);

  const hasAutoValue = autoValue !== null && autoValue !== '';
  const isManual     = editing || (manualValue !== '');
  const displayValue = isManual
    ? manualValue
    : (autoDisplay ?? (hasAutoValue ? String(autoValue) : ''));

  function handleEdit() {
    // Pre-fill with auto value so user doesn't start from scratch
    if (manualValue === '' && hasAutoValue) {
      onManualChange(String(autoValue));
    }
    setEditing(true);
  }

  function handleReset() {
    onReset();
    setEditing(false);
  }

  return (
    <div className="space-y-1">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <Label className="text-xs" style={{ color: '#6B7280' }}>
          {label}
          {hasAutoValue && !isManual && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>
              auto
            </span>
          )}
          {isManual && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>
              manual
            </span>
          )}
        </Label>

        {/* Edit / Reset button */}
        {hasAutoValue && !isManual && (
          <button type="button" onClick={handleEdit}
            className="flex items-center gap-0.5 text-[11px] hover:underline"
            style={{ color: '#C9A84C' }}>
            <Pencil className="w-2.5 h-2.5" /> Edit
          </button>
        )}
        {isManual && hasAutoValue && (
          <button type="button" onClick={handleReset}
            className="flex items-center gap-0.5 text-[11px] hover:underline"
            style={{ color: '#9CA3AF' }}>
            <RotateCcw className="w-2.5 h-2.5" /> Reset to auto
          </button>
        )}
      </div>

      {/* Input */}
      <Input
        value={displayValue}
        onChange={(e) => {
          if (!editing) setEditing(true);
          onManualChange(e.target.value);
        }}
        readOnly={!isManual}
        placeholder={placeholder ?? (hasAutoValue ? String(autoValue) : '—')}
        type={isManual ? type : 'text'}
        step={step}
        className="h-9 text-xs"
        style={{
          backgroundColor: isManual
            ? '#ffffff'
            : hasAutoValue
            ? 'rgba(5,150,105,0.04)'
            : '#F7F5F0',
          borderColor: error ? '#DC2626' : isManual ? '#C9A84C' : undefined,
          cursor: isManual ? 'text' : 'default',
        }}
      />

      {/* Hint: show auto value when manually overridden */}
      {isManual && hasAutoValue && (
        <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
          Auto-calculated value: {autoDisplay ?? autoValue}
        </p>
      )}
      {hint && !isManual && (
        <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{hint}</p>
      )}
      {error && <p className="text-[10px]" style={{ color: '#DC2626' }}>{error}</p>}
    </div>
  );
}
