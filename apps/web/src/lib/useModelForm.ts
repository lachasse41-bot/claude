import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  computeCreditCost, defaultParamValues, isParamVisible, paramsByGroup,
  type ModelSummary, type ParamGroup, type ParamSpec, type ParamValue,
} from '@nova/shared';

/**
 * Etat d'un formulaire de generation pilote par la definition du modele.
 * ---------------------------------------------------------------------------
 * - les valeurs par defaut proviennent de la definition ;
 * - les parametres masques par une condition ne sont jamais envoyes ;
 * - le cout affiche utilise exactement la meme formule que le serveur
 *   (fonction partagee), l'API restant seule juge lors du lancement.
 */
export function useModelForm(model: ModelSummary | undefined) {
  const [values, setValues] = useState<Record<string, ParamValue>>({});
  const [outputCount, setOutputCount] = useState(1);

  useEffect(() => {
    if (!model) return;
    setValues(defaultParamValues(model));
    setOutputCount(model.outputs.default);
  }, [model?.key]);

  const setValue = useCallback((paramId: string, value: ParamValue) => {
    setValues((current) => ({ ...current, [paramId]: value }));
  }, []);

  /** Parametres reellement applicables compte tenu des valeurs courantes. */
  const visibleParams = useMemo<ParamSpec[]>(
    () => (model ? model.params.filter((spec) => isParamVisible(spec, values)) : []),
    [model, values],
  );

  const groups = useMemo<Record<ParamGroup, ParamSpec[]>>(
    () => paramsByGroup(visibleParams),
    [visibleParams],
  );

  /** Payload envoye a l'API : uniquement les parametres applicables. */
  const payload = useMemo(() => {
    const output: Record<string, ParamValue> = {};
    for (const spec of visibleParams) output[spec.id] = values[spec.id] ?? null;
    return output;
  }, [visibleParams, values]);

  const estimatedCost = useMemo(
    () => (model ? computeCreditCost(model, values, outputCount) : 0),
    [model, values, outputCount],
  );

  /** Validation locale : retour immediat, sans remplacer la validation serveur. */
  const missing = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const spec of visibleParams) {
      const value = values[spec.id];
      if (spec.type === 'files') {
        const count = Array.isArray(value) ? value.length : 0;
        if (count < spec.minItems) {
          errors[spec.id] =
            spec.minItems === 1 ? 'Au moins un fichier est requis.' : `${spec.minItems} fichiers requis.`;
        }
      } else if (spec.required && (spec.type === 'text' || spec.type === 'textarea')) {
        if (!String(value ?? '').trim()) errors[spec.id] = 'Ce champ est obligatoire.';
      }
    }
    return errors;
  }, [visibleParams, values]);

  return {
    values, setValue, setValues,
    outputCount, setOutputCount,
    visibleParams, groups, payload, estimatedCost,
    missing,
    isValid: Object.keys(missing).length === 0,
  };
}
