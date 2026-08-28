import type { ParamSpec, ParamValue } from '@nova/shared';
import { Field, Input, SegmentedControl, Select, Switch, Textarea } from '../ui';
import { FilePicker } from './FilePicker';

/**
 * Rendu d'un parametre a partir de sa definition.
 * ---------------------------------------------------------------------------
 * C'est le seul endroit de l'interface qui connait les types de parametres.
 * Ajouter un modele au catalogue ne demande aucune modification ici tant qu'il
 * n'introduit pas un nouveau TYPE de controle ; en ajouter un consiste a
 * completer ce `switch` (et la validation serveur correspondante).
 */
export function ParamControl({
  spec, value, onChange, error, disabled,
}: {
  spec: ParamSpec;
  value: ParamValue;
  onChange: (value: ParamValue) => void;
  error?: string;
  disabled?: boolean;
}) {
  switch (spec.type) {
    case 'select': {
      // Peu d'options courtes : selection segmentee, plus rapide a l'usage.
      const compact = spec.options.length <= 6 && spec.options.every((o) => o.label.length <= 6);
      return (
        <Field label={spec.label} hint={spec.help} error={error} required={spec.required}>
          {compact ? (
            <SegmentedControl
              value={String(value ?? spec.default)}
              onChange={(next) => onChange(next)}
              options={spec.options.map((option) => ({
                value: option.value,
                label: option.label,
                title: option.description,
              }))}
            />
          ) : (
            <Select
              value={String(value ?? spec.default)}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value)}
            >
              {spec.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.description ? ` — ${option.description}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      );
    }

    case 'number': {
      const current = typeof value === 'number' ? value : spec.default;
      return (
        <Field
          label={
            <span className="flex w-full items-center justify-between gap-2">
              <span>{spec.label}</span>
              <span className="font-mono text-[12px] text-[var(--accent-text)]">
                {current}
                {spec.unit ?? ''}
              </span>
            </span>
          }
          hint={spec.help}
          error={error}
        >
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={current}
            disabled={disabled}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--surface-hover)] accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[11px] text-muted-fg">
            <span>{spec.min}{spec.unit ?? ''}</span>
            <span>{spec.max}{spec.unit ?? ''}</span>
          </div>
        </Field>
      );
    }

    case 'boolean':
      return (
        <div className={error ? 'rounded-lg border border-[var(--danger)] p-2' : undefined}>
          <Switch
            checked={Boolean(value)}
            disabled={disabled}
            onChange={onChange}
            label={spec.label}
            description={spec.help}
          />
        </div>
      );

    case 'text':
      return (
        <Field label={spec.label} hint={spec.help} error={error} required={spec.required}>
          <Input
            value={String(value ?? '')}
            placeholder={spec.placeholder}
            maxLength={spec.maxLength}
            disabled={disabled}
            invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );

    case 'textarea': {
      const text = String(value ?? '');
      return (
        <Field
          label={
            <span className="flex w-full items-center justify-between gap-2">
              <span>{spec.label}</span>
              <span className="text-[11px] tabular-nums text-muted-fg">
                {text.length}/{spec.maxLength}
              </span>
            </span>
          }
          hint={spec.help}
          error={error}
          required={spec.required}
        >
          <Textarea
            value={text}
            placeholder={spec.placeholder}
            maxLength={spec.maxLength}
            disabled={disabled}
            invalid={Boolean(error)}
            rows={spec.id === 'prompt' ? 5 : 3}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
    }

    case 'files':
      return (
        <Field label={spec.label} hint={spec.help} error={error} required={spec.required}>
          <FilePicker
            value={Array.isArray(value) ? value : []}
            onChange={onChange}
            accept={spec.accept}
            minItems={spec.minItems}
            maxItems={spec.maxItems}
            disabled={disabled}
          />
        </Field>
      );

    default:
      return null;
  }
}
