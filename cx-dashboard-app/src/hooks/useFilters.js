import { createContext, useContext, useMemo, useState, useCallback, createElement } from 'react';
import { subMonths } from 'date-fns';
import { isoDate } from '../utils/formatters';

const FilterContext = createContext(null);

export function defaultFilters() {
  const now = new Date();
  return {
    dateFrom: isoDate(subMonths(now, 6)),
    dateTo: isoDate(now),
    salesOrgId: '',
    salesOrgName: '',
    ownerId: '',
    ownerName: '',
  };
}

export function FilterProvider({ children }) {
  const [filters, setFilters] = useState(defaultFilters);
  // bumped by the Apply button to trigger refetches even with equal values
  const [version, setVersion] = useState(0);

  const apply = useCallback((next) => {
    setFilters((prev) => ({ ...prev, ...next }));
    setVersion((v) => v + 1);
  }, []);

  const reset = useCallback(() => {
    setFilters(defaultFilters());
    setVersion((v) => v + 1);
  }, []);

  const value = useMemo(
    () => ({ filters, apply, reset, version }),
    [filters, apply, reset, version]
  );
  return createElement(FilterContext.Provider, { value }, children);
}

export default function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used inside FilterProvider');
  return ctx;
}

/** Query params object the analytics API expects. */
export function toApiFilters(filters) {
  return {
    salesOrgId: filters.salesOrgId || undefined,
    ownerId: filters.ownerId || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  };
}
