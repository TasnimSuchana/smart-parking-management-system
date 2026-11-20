import { useCallback, useEffect, useState } from 'react';
import { errMsg } from '../utils/format.js';

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const run = useCallback(() => { setState((s) => ({ ...s, loading: true, error: null })); return fn().then((data) => setState({ data, loading: false, error: null })).catch((e) => setState({ data: null, loading: false, error: errMsg(e) })); }, deps); // eslint-disable-line
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}
