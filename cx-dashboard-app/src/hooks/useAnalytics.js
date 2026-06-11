import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Data-fetching hook with loading/error states.
 * `fetcher` is called whenever `deps` change (typically [filters, version]).
 */
export default function useAnalytics(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const run = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (id === requestId.current) setData(result);
    } catch (err) {
      if (id === requestId.current) {
        setError(err);
        // drop stale results — showing previous data next to an error is misleading
        setData(null);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, loading, error, refetch: run };
}
