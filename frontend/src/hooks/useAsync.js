import { useCallback, useEffect, useRef, useState } from 'react';

// Runs an async function and tracks its state for rendering loading / error / data.
//
//   const { data, error, loading, reload } = useAsync(getReadiness);
//
// Runs once on mount (unless immediate is false) and again whenever reload() is called.
// A result that arrives after the component unmounted, or after a newer call started,
// is ignored.
// `watch` (a string or number) re-runs the function whenever its value changes, for example
// a serialised set of filters. The previous data stays on screen until the new data arrives.
export function useAsync(asyncFunction, { immediate = true, watch = '' } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: immediate });
  const latestFunction = useRef(asyncFunction);
  const latestCall = useRef(0);

  useEffect(() => {
    latestFunction.current = asyncFunction;
  });

  const start = useCallback(() => {
    const callId = ++latestCall.current;
    const isCurrent = () => callId === latestCall.current;
    return Promise.resolve()
      .then(() => latestFunction.current())
      .then(
        (data) => isCurrent() && setState({ data, error: null, loading: false }),
        (error) => isCurrent() && setState({ data: null, error, loading: false })
      );
  }, []);

  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    return start();
  }, [start]);

  useEffect(() => {
    if (immediate) start();
    return () => {
      latestCall.current += 1; // invalidates anything still in flight
    };
  }, [immediate, start, watch]);

  return { ...state, reload };
}
