import { describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';

function createSearchHarness() {
  let state = { query: '', total: 0, activeIndex: -1, canReplace: true };
  let queryGeneration = 0;
  let onHostEvent: ((event: Record<string, unknown>) => void) | undefined;
  let resolveRefresh: ((value: unknown) => void) | undefined;
  const refresh = vi.fn(
    (input: { query: string; caseSensitive: boolean; includeDeletedText: boolean; regex: boolean }) =>
      new Promise<unknown>((resolve) => {
        const generation = ++queryGeneration;
        resolveRefresh = (value) => {
          if (generation === queryGeneration) state = value as typeof state;
          resolve(value);
        };
      }),
  );
  const search = {
    query: vi.fn((input: { query: string }) => {
      queryGeneration += 1;
      state = { query: input.query, total: input.query ? 2 : 0, activeIndex: input.query ? 0 : -1, canReplace: true };
      return state;
    }),
    getState: vi.fn(() => state),
    refresh,
  };
  const superdoc = {
    activeEditor: {
      id: 'editor',
      editorVersion: 2,
      host: {
        events: {
          subscribe(listener: (event: Record<string, unknown>) => void) {
            onHostEvent = listener;
            return () => {
              onHostEvent = undefined;
            };
          },
        },
      },
      editCommands: { search, getSnapshot: () => ({ commands: {} }) },
    },
    on: vi.fn(),
    off: vi.fn(),
  };
  return {
    superdoc,
    search,
    emitMutation: () => onHostEvent?.({ type: 'document:mutated', hasCommitEvent: false }),
    settleRefresh: (value: unknown) => resolveRefresh?.(value),
  };
}

describe('active search refresh after a document mutation', () => {
  it('requeries with the active options and publishes the new count', async () => {
    const harness = createSearchHarness();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    const totals: number[] = [];
    ui.search.subscribe(() => totals.push(ui.search.getSnapshot().total));
    ui.search.open();
    ui.search.find('needle', { caseSensitive: true, includeTrackedDeletions: true, regex: true });
    expect(ui.search.getSnapshot().total).toBe(2);

    harness.emitMutation();
    await vi.waitFor(() =>
      expect(harness.search.refresh).toHaveBeenCalledWith({
        query: 'needle',
        caseSensitive: true,
        includeDeletedText: true,
        regex: true,
      }),
    );
    harness.settleRefresh({ query: 'needle', total: 3, activeIndex: 0, canReplace: true });
    await vi.waitFor(() => expect(totals.at(-1)).toBe(3));
    expect(ui.search.getSnapshot().total).toBe(3);
    ui.destroy();
  });

  it('does not publish a refresh that settles after close', async () => {
    const harness = createSearchHarness();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    ui.search.find('needle');
    harness.emitMutation();
    await vi.waitFor(() => expect(harness.search.refresh).toHaveBeenCalledOnce());
    ui.search.close();
    const totals: number[] = [];
    ui.search.subscribe(() => totals.push(ui.search.getSnapshot().total));
    harness.settleRefresh({ query: 'needle', total: 99, activeIndex: 0, canReplace: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(totals).not.toContain(99);
    expect(ui.search.getSnapshot().total).toBe(0);
    ui.destroy();
  });

  it('invalidates a host-owned session whose refresh enters the async shell fallback', async () => {
    let hostState = { query: '', total: 0, activeMatchIndex: -1, canReplace: true };
    let shellGeneration = 0;
    let settleRefresh: (() => void) | undefined;
    let onHostEvent: ((event: Record<string, unknown>) => void) | undefined;
    const hostSearch = {
      setSession: vi.fn((query: string) => {
        hostState = { query, total: 2, activeMatchIndex: 0, canReplace: true };
        return hostState;
      }),
      getState: vi.fn(() => hostState),
      clear: vi.fn(() => {
        hostState = { query: '', total: 0, activeMatchIndex: -1, canReplace: true };
      }),
      refresh: vi.fn(() => {
        hostState = { ...hostState, total: 0, activeMatchIndex: -1 };
        return hostState;
      }),
    };
    const shellSearch = {
      query: vi.fn(() => {
        shellGeneration += 1;
        return { total: 0, activeIndex: -1 };
      }),
      getState: vi.fn(() => hostState),
      refresh: vi.fn(
        () =>
          new Promise((resolve) => {
            const generation = ++shellGeneration;
            settleRefresh = () => {
              if (generation === shellGeneration)
                hostState = { query: 'needle', total: 99, activeMatchIndex: 0, canReplace: true };
              resolve(hostState);
            };
          }),
      ),
    };
    const superdoc = {
      activeEditor: {
        id: 'editor',
        editorVersion: 2,
        host: {
          search: hostSearch,
          events: {
            subscribe(listener: (event: Record<string, unknown>) => void) {
              onHostEvent = listener;
              return () => {
                onHostEvent = undefined;
              };
            },
          },
        },
        editCommands: { search: shellSearch, getSnapshot: () => ({ commands: {} }) },
      },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc: superdoc as never });
    ui.search.find('needle');
    onHostEvent?.({ type: 'document:mutated', hasCommitEvent: false });
    await vi.waitFor(() => expect(shellSearch.refresh).toHaveBeenCalledOnce());
    ui.search.close();
    settleRefresh?.();
    await Promise.resolve();
    expect(shellSearch.query).toHaveBeenCalledWith({ query: '' });
    expect(ui.search.getSnapshot().total).toBe(0);
    ui.destroy();
  });
});
