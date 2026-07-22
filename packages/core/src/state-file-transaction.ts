import { readFile, rm } from 'node:fs/promises';

import { writeAtomicTextAsync } from './atomic-file';
import { isFileNotFoundError } from './fs-error';

type FileSnapshot = {
  path: string;
  content: string | undefined;
};

const readFileSnapshot = async (path: string): Promise<FileSnapshot> => {
  try {
    return { path, content: await readFile(path, 'utf8') };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return { path, content: undefined };
    }
    throw error;
  }
};

const readSnapshots = async (paths: string[]): Promise<FileSnapshot[]> =>
  Promise.all(paths.map((path) => readFileSnapshot(path)));

const restoreSnapshot = async (snapshot: FileSnapshot): Promise<void> => {
  if (snapshot.content === undefined) {
    await rm(snapshot.path, { force: true });
    return;
  }
  await writeAtomicTextAsync(snapshot.path, snapshot.content);
};

export type StateFileTransaction = {
  checkpoint: () => Promise<void>;
  rollback: () => Promise<void>;
};

export const createStateFileTransaction = async (
  paths: string[],
): Promise<StateFileTransaction> => {
  const before = await readSnapshots(paths);
  let expected = before;
  let checkpointCreated = false;

  return {
    checkpoint: async () => {
      expected = await readSnapshots(paths);
      checkpointCreated = true;
    },
    rollback: async () => {
      if (checkpointCreated) {
        const current = await readSnapshots(paths);
        const changedOutsideTransaction = current
          .filter((snapshot, index) => snapshot.content !== expected[index]?.content)
          .map((snapshot) => snapshot.path);
        if (changedOutsideTransaction.length > 0) {
          throw new Error(
            `State changed while attempting rollback: ${changedOutsideTransaction.join(', ')}`,
          );
        }
      }
      await Promise.all(before.map((snapshot) => restoreSnapshot(snapshot)));
    },
  };
};

export const throwStateOperationCause = (cause: unknown): never => {
  if (cause instanceof Error) {
    throw cause;
  }
  throw new Error('Provider operation failed.', { cause });
};

export const throwStateRollbackError = (
  cause: unknown,
  rollbackErrors: unknown[],
  message = 'Provider operation failed and its state could not be rolled back safely.',
): never => {
  throw new AggregateError([cause, ...rollbackErrors], message, { cause });
};

export const rollbackStateFileTransaction = async (
  transaction: StateFileTransaction,
  cause: unknown,
): Promise<never> => {
  try {
    await transaction.rollback();
  } catch (rollbackError) {
    return throwStateRollbackError(cause, [rollbackError]);
  }
  return throwStateOperationCause(cause);
};
