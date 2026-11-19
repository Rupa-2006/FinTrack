import { act, renderHook, waitFor } from '@testing-library/react';
import { useAsync } from './useAsync.js';

describe('useAsync', () => {
  test('starts loading, then exposes the data', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve('ready')));
    expect(result.current).toMatchObject({ loading: true, data: null, error: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe('ready');
  });

  test('exposes the error when the function rejects', async () => {
    const failure = new Error('down');
    const { result } = renderHook(() => useAsync(() => Promise.reject(failure)));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: null, error: failure });
  });

  test('does nothing until reload() when immediate is false', async () => {
    const fn = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => useAsync(fn, { immediate: false }));
    expect(result.current.loading).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    await act(() => result.current.reload());
    expect(result.current.data).toBe(1);
  });

  test('a slow earlier call cannot overwrite a newer result', async () => {
    const resolvers = [];
    const fn = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const { result } = renderHook(() => useAsync(fn, { immediate: false }));
    let first;
    let second;
    act(() => {
      first = result.current.reload();
      second = result.current.reload();
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => {
      resolvers[1]('newer');
      await second;
      resolvers[0]('older');
      await first;
    });
    expect(result.current.data).toBe('newer');
  });

  test('a result arriving after unmount is ignored', async () => {
    let resolve;
    const { result, unmount } = renderHook(() => useAsync(() => new Promise((r) => (resolve = r))));
    await waitFor(() => expect(resolve).toBeDefined());
    unmount();
    await act(async () => resolve('late'));
    expect(result.current.data).toBeNull();
  });
});
