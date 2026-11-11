import { FirebaseError } from '@firebase/util';
import { describe, expect, it, vi } from 'vitest';
import { convertTrialToFirestore, retryOnPermissionDenied } from '../firestore/app/run';

describe('convertTrialToFirestore', () => {
  it('removes all undefined properties', () => {
    const trialData = {
      a: 1,
      b: undefined,
      c: {
        d: 2,
        e: undefined,
        f: {
          g: 3,
          h: undefined,
        },
      },
    };

    const expected = {
      a: 1,
      c: {
        d: 2,
        f: {
          g: 3,
        },
      },
    };

    expect(convertTrialToFirestore(trialData)).toEqual(expected);
  });
});

describe('retryOnPermissionDenied', () => {
  it('does not refresh auth when the write succeeds', async () => {
    const operation = vi.fn().mockResolvedValue(undefined);
    const refreshAuth = vi.fn();

    await retryOnPermissionDenied(operation, refreshAuth);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it('refreshes auth and writes the same trial again after permission-denied', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new FirebaseError('permission-denied', 'Missing or insufficient permissions.'))
      .mockResolvedValueOnce(undefined);
    const refreshAuth = vi.fn().mockResolvedValue(undefined);

    await retryOnPermissionDenied(operation, refreshAuth);

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('throws when the retry is also denied', async () => {
    const denied = new FirebaseError('permission-denied', 'Missing or insufficient permissions.');
    const operation = vi.fn().mockRejectedValue(denied);
    const refreshAuth = vi.fn().mockResolvedValue(undefined);

    await expect(retryOnPermissionDenied(operation, refreshAuth)).rejects.toBe(denied);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry other Firestore errors', async () => {
    const unavailable = new FirebaseError('unavailable', 'The client is offline.');
    const operation = vi.fn().mockRejectedValue(unavailable);
    const refreshAuth = vi.fn();

    await expect(retryOnPermissionDenied(operation, refreshAuth)).rejects.toBe(unavailable);
    expect(refreshAuth).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
