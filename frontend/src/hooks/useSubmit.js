import { useCallback, useState } from 'react';

const IDLE = { submitting: false, fieldErrors: {}, formError: null };

// Runs a form's save action and turns API failures into state for rendering:
// per-field messages when the server names fields, otherwise one form-level message.
//
//   const { submit, submitting, fieldErrors, formError } = useSubmit(createGoal, { onSuccess });
export function useSubmit(action, { onSuccess } = {}) {
  const [state, setState] = useState(IDLE);

  const submit = useCallback(
    async (...args) => {
      setState({ ...IDLE, submitting: true });
      try {
        const result = await action(...args);
        setState(IDLE);
        onSuccess?.(result);
        return true;
      } catch (err) {
        const fieldErrors = err.fieldErrors ?? {};
        setState({ submitting: false, fieldErrors, formError: Object.keys(fieldErrors).length ? null : err.message || 'Something went wrong. Please try again.' });
        return false;
      }
    },
    [action, onSuccess]
  );

  const reset = useCallback(() => setState(IDLE), []);
  return { ...state, submit, reset };
}
