import { FirebaseError } from 'firebase/app';
import { Functions, httpsCallable } from 'firebase/functions';
import {
  FirebaseErrorSchema,
  FunctionsErrorSchema,
  ParsedFirebaseError,
  ParsedFunctionsError,
  type ZodType,
} from '@levante-framework/levante-zod';

type CallableResult<TResult, TError> =
  | { code: 'success'; data: TResult }
  | { code: 'app-error'; data: TError }
  | { code: 'functions-error'; data: ParsedFunctionsError }
  | { code: 'firebase-error'; data: ParsedFirebaseError }
  | { code: 'error'; data: Error };

export async function callFirebaseFunction<TParams, TResult, TError>(
  functions: Functions | undefined,
  name: string,
  params: TParams,
  appErrorSchema: ZodType<TError>,
): Promise<CallableResult<TResult, TError>> {
  try {
    if (!functions) throw new Error('Functions is not initialized');

    const req = httpsCallable(functions, name);
    const res = await req(params);

    return { code: 'success', data: res.data as TResult };
  } catch (err: unknown) {
    if (err instanceof FirebaseError) {
      const appError = appErrorSchema.safeParse(err);
      if (appError.success) return { code: 'app-error', data: appError.data };

      const functionsError = FunctionsErrorSchema.safeParse(err);
      if (functionsError.success) return { code: 'functions-error', data: functionsError.data };

      const firebaseError = FirebaseErrorSchema.safeParse(err);
      if (firebaseError.success) return { code: 'firebase-error', data: firebaseError.data };
    }

    if (err instanceof Error) return { code: 'error', data: err };
    return { code: 'error', data: new Error(`Unexpected ${name} error`, { cause: err }) };
  }
}
